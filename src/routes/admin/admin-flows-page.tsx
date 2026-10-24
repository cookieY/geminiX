import i18next from "@/shared/i18n";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Database, EyeOff, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { Checkbox } from "@/shared/components/ui/checkbox";
import type { Flow, FlowMaskingRule, User } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { StatusBadge } from "@/shared/components/status/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Button } from "@/shared/components/ui/button";
import { TableSearchInput } from "@/shared/components/table-search-input";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateFlow,
  useDatasources,
  useDeleteFlow,
  useFlows,
  useFlowMaskingRules,
  useReplaceFlow,
  useReplaceMaskingRule,
  useRuleSets,
  useUsers,
} from "@/features/admin/use-admin";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import { DropdownMenuItem } from "@/shared/components/ui/dropdown-menu";
import { TableRowActions } from "@/shared/components/table-row-actions";
import { ListToolbar, PageHeader, PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";

/**
 * 流程管理 (route /admin/flows; migration contract §2 maps legacy
 * /manager/flow here, §3 field mapping). Two STRICTLY separate forms:
 * - Change flow: 名称/启停/一套Rule Set → 1..N 串行Stage，每Stage一个数据源
 *   +Schema Mapping+1..10审核Step+执行人（用户UUID）。
 * - Query flow: 名称/启停 → 数据源×(query/export能力) → 1..10访问审批Step。
 *   不得出现SQL、Rule Set或执行人字段 (§3)。
 * The old flow editor's step-type model (提交/审核/执行 mixed types, max 5
 * audit layers) is gone: v4 stages carry the execution actors and approval
 * steps uniformly. Editing shows the 不会影响已提交工单 note (§3). Query
 * flows additionally expose the per-datasource sensitive-column vocabulary
 * (Q006 admin face; ≤256 literal columns, case-fold normalized server-side).
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

interface StageDraft {
  position: number;
  datasourceId: string;
  schemaMappings: { logical_schema: string; physical_schema: string }[];
  approvalSteps: { position: number; actorIds: string[] }[];
  executionActorIds: string[];
}

interface FlowFormState {
  name: string;
  enabled: boolean;
  ruleSetId: string;
  stages: StageDraft[];
  queryCapabilities: { datasourceId: string; canExport: boolean }[];
  approvalSteps: { position: number; actorIds: string[] }[];
}

const EMPTY_FORM: FlowFormState = {
  name: "",
  enabled: true,
  ruleSetId: "",
  stages: [],
  queryCapabilities: [],
  approvalSteps: [],
};

export default function AdminFlowsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const pager = useCursorPage(20);
  const [search, setSearch] = useState("");

  const flowsQuery = useFlows(isAdmin, { limit: pager.pageSize, after: pager.after, q: search.trim() || undefined });
  // §18.82：先于穷尽三元捕获，避免收窄泄漏进分页守卫。
  const flowsLoaded = !flowsQuery.isPending && !flowsQuery.isError;
  const [editing, setEditing] = useState<Flow | null>(null);
  const [createType, setCreateType] = useState<"change_review" | "query_access" | null>(null);

  // §18.73：搜索走服务端q；keyword仅用于空态文案区分。
  const keyword = search.trim();
  const flows = flowsQuery.data?.items ?? [];
  // 搜索在服务端收窄；行集合变化时把整行位移补间掉。
  const flowsBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(flows.map((flow) => flow.id)),
  );

  return (
    <PageLayout data-testid="admin-flows-page">
      <PageHeader
        title={t("adminFlows.title")}
        description={t("adminFlows.description")}
        icon={Workflow}
        actions={
          <>
          <Button variant="outline" onClick={() => { setCreateType("change_review"); }} data-testid="admin-flows-create-change">
            <Plus />
            {t("adminFlows.createChange")}
          </Button>
          <Button onClick={() => { setCreateType("query_access"); }} data-testid="admin-flows-create-query">
            <Plus />
            {t("adminFlows.createQuery")}
          </Button>
          </>
        }
      />

      <Card>
        <ListToolbar
          busy={flowsQuery.isFetching && !flowsQuery.isPending}
          search={
            <TableSearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                pager.reset();
              }}
              testId="admin-flows-search"
            />
          }
        />
        <CardContent className="px-0!">
          {flowsQuery.isPending ? (
            <LoadingState variant="table" columns={5} />
          ) : flowsQuery.error !== null ? (
            <ErrorState error={flowsQuery.error} operationId="listFlows" onRetry={() => void flowsQuery.refetch()} />
          ) : (
            <>
              {flows.length === 0 ? (
                <EmptyState
                  title={keyword !== "" ? t("table.emptySearch") : t("adminFlows.empty")}
                  filtered={keyword !== ""}
                  testId="admin-flows-empty"
                />
              ) : (
              <Table data-testid="admin-flows-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminFlows.column.name")}</TableHead>
                    <TableHead>{t("adminFlows.column.kind")}</TableHead>
                    <TableHead>{t("adminFlows.column.enabled")}</TableHead>
                    <TableHead>{t("adminFlows.column.structure")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody ref={flowsBodyRef} stale={flowsQuery.isFetching && flowsQuery.isPlaceholderData}>
                  {flows.map((flow) => (
                    <FlowRow key={flow.id} flow={flow} onEdit={() => { setEditing(flow); }} />
                  ))}
                </TableBody>
              </Table>
              )}
              {flowsLoaded ? (
                <TablePagination
                  busy={flowsQuery.isFetching && flowsQuery.isPlaceholderData}
                  page={pager.pageNo}
                  hasMore={flowsQuery.data.page.has_more}
                  isFirst={pager.isFirst}
                  onPrev={pager.goPrev}
                  onJumpPage={pager.goToPage}
                  onNext={() => {
                    pager.pushCursor(flowsQuery.data.page.next_cursor);
                  }}
                  pageSize={pager.pageSize}
                  onPageSizeChange={pager.setPageSize}
                  rowsOnPage={flowsQuery.data.items.length}
                  testIdPrefix="flows"
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <FlowFormDialog
        open={createType !== null || editing !== null}
        flowType={editing?.flow_type ?? createType ?? "change_review"}
        editing={editing}
        onClose={() => {
          setEditing(null);
          setCreateType(null);
        }}
      />
    </PageLayout>
  );
}

function FlowRow({ flow, onEdit }: { flow: Flow; onEdit: () => void }) {
  const { t } = useTranslation();
  const deleteFlow = useDeleteFlow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const isQuery = flow.flow_type === "query_access";

  return (
    <>
      <TableRow data-testid={`admin-flow-row-${flow.id}`} data-row-key={flow.id}>
        <TableCell className="font-semibold text-foreground">{flow.name}</TableCell>
        <TableCell>
          <Badge variant="outline">
            {isQuery ? t("adminFlows.kind.query") : t("adminFlows.kind.change")}
          </Badge>
        </TableCell>
        <TableCell>
          <StatusBadge tone={flow.enabled ? "emerald" : "stone"}>
            {flow.enabled ? t("adminFlows.enabled") : t("adminFlows.disabled")}
          </StatusBadge>
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {isQuery
            ? t("adminFlows.structure.query", {
                datasources: flow.query_capabilities?.length ?? 0,
                steps: flow.approval_steps?.length ?? 0,
              })
            : t("adminFlows.structure.change", {
                stages: flow.stages?.length ?? 0,
              })}
        </TableCell>
        <TableCell className="text-right">
          <TableRowActions testId={`admin-flow-actions-${flow.id}`}>
            <DropdownMenuItem onClick={onEdit} data-testid={`admin-flow-edit-${flow.id}`}>
              <Pencil /> {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setErrorText(null);
                setConfirmOpen(true);
              }}
              data-testid={`admin-flow-delete-${flow.id}`}
            >
              <Trash2 /> {t("common.delete")}
            </DropdownMenuItem>
          </TableRowActions>
        </TableCell>
      </TableRow>

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!next) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminFlows.delete.title", { name: flow.name })}</DialogTitle>
            <DialogDescription>{t("adminFlows.delete.description")}</DialogDescription>
          </DialogHeader>
          {errorText !== null && (
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <PendingButton
              variant="destructive"
              pending={deleteFlow.isPending}
              onClick={() => {
                deleteFlow.mutate(
                  { flowId: flow.id, version: flow.version },
                  {
                    onSuccess: () => { setConfirmOpen(false); },
                    onError: (error) => { setErrorText(describeErrorText(describeError(error, "deleteFlow"))); },
                  },
                );
              }}
              data-testid="admin-flow-delete-confirm"
            >
              {t("adminFlows.delete.confirm")}
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FlowFormDialog({
  open,
  flowType,
  editing,
  onClose,
}: {
  open: boolean;
  flowType: "change_review" | "query_access";
  editing: Flow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const datasourcesQuery = useDatasources(isAdmin);
  const usersQuery = useUsers(isAdmin);
  const ruleSetsQuery = useRuleSets(isAdmin);
  const createFlow = useCreateFlow();
  const replaceFlow = useReplaceFlow();

  const [form, setForm] = useState<FlowFormState>(EMPTY_FORM);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const formKey = editing?.id ?? `create-${flowType}`;
  if (open && openFor !== formKey) {
    setOpenFor(formKey);
    setForm(
      editing === null
        ? { ...EMPTY_FORM }
        : {
            name: editing.name,
            enabled: editing.enabled,
            ruleSetId: editing.rule_set_id ?? "",
            stages: (editing.stages ?? []).map((stage) => ({
              position: stage.position,
              datasourceId: stage.datasource_id,
              schemaMappings: stage.schema_mappings.map((mapping) => ({
                logical_schema: mapping.logical_schema,
                physical_schema: mapping.physical_schema,
              })),
              approvalSteps: stage.approval_steps.map((step) => ({
                position: step.position,
                actorIds: step.actors.map((actor) => actor.user_id),
              })),
              executionActorIds: stage.execution_actors.map((actor) => actor.user_id),
            })),
            queryCapabilities: (editing.query_capabilities ?? []).map((capability) => ({
              datasourceId: capability.datasource_id,
              canExport: capability.can_export,
            })),
            approvalSteps: (editing.approval_steps ?? []).map((step) => ({
              position: step.position,
              actorIds: step.actors.map((actor) => actor.user_id),
            })),
          },
    );
    setErrorText(null);
  }
  if (!open && openFor !== null) setOpenFor(null);

  const datasources = useMemo(() => datasourcesQuery.data?.items ?? [], [datasourcesQuery.data]);
  const users = usersQuery.data?.items ?? [];
  const ruleSets = ruleSetsQuery.data?.items ?? [];

  // BUG-005方案A：同引擎校验的前端镜像（后端权威校验兜底）。
  const engineMismatch = useMemo(() => {
    if (flowType !== "change_review") return false;
    const engines = form.stages
      .map((stage) => datasources.find((ds) => ds.id === stage.datasourceId))
      .map((ds) => (ds ? `${ds.engine}/${ds.compatibility_mode}` : ""));
    return engines.length >= 2 && engines.some((e) => e !== engines[0]);
  }, [datasources, flowType, form]);

  const valid = useMemo(() => {
    if (form.name.trim() === "") return false;
    if (flowType === "change_review") {
      if (engineMismatch) return false;
      return (
        form.stages.length >= 1 &&
        form.stages.every(
          (stage) =>
            stage.datasourceId !== "" &&
            stage.approvalSteps.length >= 1 &&
            stage.approvalSteps.length <= 10 &&
            stage.approvalSteps.every((step) => step.actorIds.length >= 1) &&
            stage.executionActorIds.length >= 1,
        )
      );
    }
    return (
      form.queryCapabilities.length >= 1 &&
      form.approvalSteps.length >= 1 &&
      form.approvalSteps.length <= 10 &&
      form.approvalSteps.every((step) => step.actorIds.length >= 1)
    );
  }, [engineMismatch, flowType, form]);

  const submit = async () => {
    setErrorText(null);
    const body =
      flowType === "change_review"
        ? {
            name: form.name,
            flow_type: flowType,
            enabled: form.enabled,
            rule_set_id: form.ruleSetId === "" ? null : form.ruleSetId,
            stages: form.stages.map((stage) => ({
              position: stage.position,
              datasource_id: stage.datasourceId,
              schema_mappings: stage.schemaMappings,
              approval_steps: stage.approvalSteps.map((step) => ({
                position: step.position,
                actors: step.actorIds.map((user_id) => ({ user_id })),
              })),
              execution_actors: stage.executionActorIds.map((user_id) => ({ user_id })),
            })),
          }
        : {
            name: form.name,
            flow_type: flowType,
            enabled: form.enabled,
            query_capabilities: form.queryCapabilities.map((capability) => ({
              datasource_id: capability.datasourceId,
              can_query: true as const,
              can_export: capability.canExport,
            })),
            approval_steps: form.approvalSteps.map((step) => ({
              position: step.position,
              actors: step.actorIds.map((user_id) => ({ user_id })),
            })),
          };
    try {
      if (editing === null) {
        await createFlow.mutateAsync(body);
      } else {
        await replaceFlow.mutateAsync({ flowId: editing.id, version: editing.version, body });
      }
      toast.success(editing === null ? t("common.createdToast") : t("common.savedToast"));
      onClose();
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, editing === null ? "createFlow" : "replaceFlow")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null
              ? flowType === "change_review"
                ? t("adminFlows.createChange")
                : t("adminFlows.createQuery")
              : t("adminFlows.editTitle", { name: editing.name })}
          </DialogTitle>
          <DialogDescription>{t("adminFlows.formDescription")}</DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>{t("adminFlows.noRetroactiveNote")}</AlertDescription>
        </Alert>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="flow-name">{t("adminFlows.column.name")}</Label>
            <Input
              id="flow-name"
              value={form.name}
              onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
              maxLength={128}
              data-testid="flow-name"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={form.enabled}
              onCheckedChange={(checked) => { setForm({ ...form, enabled: checked }); }}
              data-testid="flow-enabled"
            />
            {t("adminFlows.column.enabled")}
          </label>

          {flowType === "change_review" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t("adminFlows.ruleSet")}</Label>
                {/* §18.59：Base UI Select（owner裁定"必须使用UI组件"）。 */}
                <Select
                  value={form.ruleSetId === "" ? undefined : form.ruleSetId}
                  onValueChange={(value) => { setForm({ ...form, ruleSetId: value ?? "" }); }}
                  items={Object.fromEntries(ruleSets.map((ruleSet) => [ruleSet.id, ruleSet.name]))}
                >
                  <SelectTrigger
                    className="h-9 w-full text-sm"
                    aria-label={t("adminFlows.ruleSet")}
                    data-testid="flow-rule-set"
                  >
                    <SelectValue placeholder={t("adminFlows.noRuleSet")} />
                  </SelectTrigger>
                  <SelectContent>
                    {ruleSets.map((ruleSet) => (
                      <SelectItem key={ruleSet.id} value={ruleSet.id}>
                        {ruleSet.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label>{t("adminFlows.stages")}</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setForm((current) => ({
                        ...current,
                        stages: [
                          ...current.stages,
                          {
                            position: current.stages.length + 1,
                            datasourceId: "",
                            schemaMappings: [],
                            approvalSteps: [{ position: 1, actorIds: [] }],
                            executionActorIds: [],
                          },
                        ],
                      })); }
                    }
                    data-testid="flow-add-stage"
                  >
                    <Plus />
                    {t("adminFlows.addStage")}
                  </Button>
                </div>
                {form.stages.map((stage, stageIndex) => (
                  <div key={stageIndex} className="flex flex-col gap-2 rounded-md border p-3" data-testid={`flow-stage-${String(stageIndex)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t("adminFlows.stageTitle", { index: stage.position })}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={stageIndex === 0}
                          onClick={() => { setForm((current) => {
                              const upper = current.stages[stageIndex - 1];
                              const lower = current.stages[stageIndex];
                              if (upper === undefined || lower === undefined) return current;
                              const stages = [...current.stages];
                              stages[stageIndex - 1] = lower;
                              stages[stageIndex] = upper;
                              return { ...current, stages: stages.map((item, index) => ({ ...item, position: index + 1 })) };
                            }); }
                          }
                          aria-label={t("adminFlows.stageUp", { index: String(stage.position) })}
                          data-testid={`flow-stage-up-${String(stageIndex)}`}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={stageIndex === form.stages.length - 1}
                          onClick={() => { setForm((current) => {
                              const upper = current.stages[stageIndex];
                              const lower = current.stages[stageIndex + 1];
                              if (upper === undefined || lower === undefined) return current;
                              const stages = [...current.stages];
                              stages[stageIndex] = lower;
                              stages[stageIndex + 1] = upper;
                              return { ...current, stages: stages.map((item, index) => ({ ...item, position: index + 1 })) };
                            }); }
                          }
                          aria-label={t("adminFlows.stageDown", { index: String(stage.position) })}
                          data-testid={`flow-stage-down-${String(stageIndex)}`}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setForm((current) => ({
                              ...current,
                              stages: current.stages
                                .filter((_, index) => index !== stageIndex)
                                .map((item, index) => ({ ...item, position: index + 1 })),
                            })); }
                          }
                          aria-label={t("adminFlows.stageRemove", { index: String(stage.position) })}
                          data-testid={`flow-stage-remove-${String(stageIndex)}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("adminFlows.stageDatasource")}</Label>
                      <Select
                        value={stage.datasourceId === "" ? undefined : stage.datasourceId}
                        onValueChange={(value) => { setForm((current) => {
                            const stages = [...current.stages];
                            stages[stageIndex] = { ...stage, datasourceId: value ?? "" };
                            return { ...current, stages };
                          }); }
                        }
                        items={Object.fromEntries(datasources.map((datasource) => [datasource.id, datasource.name]))}
                      >
                        <SelectTrigger
                          className="h-9 w-full text-sm"
                          aria-label={t("adminFlows.stageDatasource", { index: String(stage.position) })}
                          data-testid={`flow-stage-datasource-${String(stageIndex)}`}
                        >
                          <SelectValue placeholder={t("adminFlows.pickDatasource")} />
                        </SelectTrigger>
                        <SelectContent>
                          {datasources.map((datasource) => (
                            <SelectItem key={datasource.id} value={datasource.id}>
                              {datasource.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("adminFlows.schemaMappings")}</Label>
                      <p className="text-muted-foreground text-xs">{t("adminFlows.schemaMappingsHint")}</p>
                      <div className="flex flex-col gap-1">
                        {stage.schemaMappings.map((mapping, mappingIndex) => (
                          <div key={mappingIndex} className="flex items-center gap-2">
                            <Input
                              value={mapping.logical_schema}
                              onChange={(event) => { setForm((current) => {
                                  const stages = [...current.stages];
                                  const mappings = [...stage.schemaMappings];
                                  mappings[mappingIndex] = { ...mapping, logical_schema: event.target.value };
                                  stages[stageIndex] = { ...stage, schemaMappings: mappings };
                                  return { ...current, stages };
                                }); }
                              }
                              placeholder={t("adminFlows.logicalSchema")}
                              className="h-8 font-mono text-xs"
                              maxLength={128}
                            />
                            <span className="text-muted-foreground text-xs">→</span>
                            <Input
                              value={mapping.physical_schema}
                              onChange={(event) => { setForm((current) => {
                                  const stages = [...current.stages];
                                  const mappings = [...stage.schemaMappings];
                                  mappings[mappingIndex] = { ...mapping, physical_schema: event.target.value };
                                  stages[stageIndex] = { ...stage, schemaMappings: mappings };
                                  return { ...current, stages };
                                }); }
                              }
                              placeholder={t("adminFlows.physicalSchema")}
                              className="h-8 font-mono text-xs"
                              maxLength={128}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t("adminFlows.mappingRemove", { index: String(mappingIndex + 1) })}
                              onClick={() => { setForm((current) => {
                                  const stages = [...current.stages];
                                  stages[stageIndex] = {
                                    ...stage,
                                    schemaMappings: stage.schemaMappings.filter((_, index) => index !== mappingIndex),
                                  };
                                  return { ...current, stages };
                                }); }
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setForm((current) => {
                              const stages = [...current.stages];
                              stages[stageIndex] = {
                                ...stage,
                                schemaMappings: [...stage.schemaMappings, { logical_schema: "", physical_schema: "" }],
                              };
                              return { ...current, stages };
                            }); }
                          }
                          data-testid={`flow-stage-add-mapping-${String(stageIndex)}`}
                        >
                          <Plus />
                          {t("adminFlows.addMapping")}
                        </Button>
                      </div>
                    </div>
                    <ApprovalStepsEditor
                      steps={stage.approvalSteps}
                      users={users}
                      onChange={(steps) => { setForm((current) => {
                          const stages = [...current.stages];
                          stages[stageIndex] = { ...stage, approvalSteps: steps };
                          return { ...current, stages };
                        }); }
                      }
                      testIdPrefix={`flow-stage-${String(stageIndex)}`}
                    />
                    <ActorPicker
                      label={t("adminFlows.executionActors")}
                      users={users}
                      selected={stage.executionActorIds}
                      onChange={(ids) => { setForm((current) => {
                          const stages = [...current.stages];
                          stages[stageIndex] = { ...stage, executionActorIds: ids };
                          return { ...current, stages };
                        }); }
                      }
                      testIdPrefix={`flow-stage-${String(stageIndex)}-exec`}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t("adminFlows.queryDatasources")}</Label>
                <p className="text-muted-foreground text-xs">{t("adminFlows.queryDatasourcesHint")}</p>
                <div className="flex flex-col gap-1 rounded-md border p-2">
                  {datasources.map((datasource) => {
                    const selected = form.queryCapabilities.find((capability) => capability.datasourceId === datasource.id);
                    return (
                      <div key={datasource.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                        <Checkbox
                          checked={selected !== undefined}
                          onCheckedChange={(checked) => {
                            setForm((current) => ({
                              ...current,
                              queryCapabilities: checked
                                ? [...current.queryCapabilities, { datasourceId: datasource.id, canExport: false }]
                                : current.queryCapabilities.filter((capability) => capability.datasourceId !== datasource.id),
                            }));
                          }}
                          data-testid={`flow-query-ds-${datasource.id}`}
                        />
                        <Database className="size-3.5 text-muted-foreground" />
                        {datasource.name}
                        {selected !== undefined && (
                          <label className="ml-auto flex cursor-pointer items-center gap-1 text-xs">
                            <Checkbox
                              checked={selected.canExport}
                              onCheckedChange={(checked) => {
                                setForm((current) => ({
                                  ...current,
                                  queryCapabilities: current.queryCapabilities.map((capability) =>
                                    capability.datasourceId === datasource.id
                                      ? { ...capability, canExport: checked }
                                      : capability,
                                  ),
                                }));
                              }}
                              data-testid={`flow-query-export-${datasource.id}`}
                            />
                            {t("adminFlows.canExport")}
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <ApprovalStepsEditor
                steps={form.approvalSteps}
                users={users}
                onChange={(steps) => { setForm({ ...form, approvalSteps: steps }); }}
                testIdPrefix="flow-query"
              />
              {editing !== null && <MaskingRulesSection flow={editing} />}
            </>
          )}

          {errorText !== null && (
            <Alert variant="destructive" data-testid="flow-form-error">
              <AlertTitle>{t("adminFlows.formFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {engineMismatch && (
            <Alert variant="destructive" data-testid="flow-engine-mismatch">
              <AlertDescription>{t("adminFlows.engineMismatch")}</AlertDescription>
            </Alert>
          )}
          <PendingButton
            pending={createFlow.isPending || replaceFlow.isPending}
            disabled={!valid}
            onClick={() => void submit()}
            data-testid="flow-form-submit"
          >
            {t("common.save")}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalStepsEditor({
  steps,
  users,
  onChange,
  testIdPrefix,
}: {
  steps: { position: number; actorIds: string[] }[];
  users: User[];
  onChange: (steps: { position: number; actorIds: string[] }[]) => void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{t("adminFlows.approvalSteps")}</Label>
        {steps.length < 10 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { onChange([...steps, { position: steps.length + 1, actorIds: [] }]); }}
            data-testid={`${testIdPrefix}-add-step`}
          >
            <Plus />
            {t("adminFlows.addStep")}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("adminFlows.approvalStepsHint")}</p>
      {steps.map((step, stepIndex) => (
        <div key={stepIndex} className="flex flex-col gap-1 rounded-md border p-2" data-testid={`${testIdPrefix}-step-${String(stepIndex)}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{t("adminFlows.stepTitle", { index: step.position })}</span>
            <span className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={step.actorIds.length > 0 && step.actorIds.length === users.length}
                  indeterminate={step.actorIds.length > 0 && step.actorIds.length < users.length}
                  onCheckedChange={() => {
                    const allSelected = step.actorIds.length > 0 && step.actorIds.length === users.length;
                    onChange(
                      steps.map((item, index) =>
                        index === stepIndex
                          ? { ...item, actorIds: allSelected ? [] : users.map((user) => user.id) }
                          : item,
                      ),
                    );
                  }}
                  data-testid={`${testIdPrefix}-step-${String(stepIndex)}-select-all`}
                />
                {t("adminFlows.selectAll")}
                <span className="tabular-nums" data-testid={`${testIdPrefix}-step-${String(stepIndex)}-select-all-count`}>
                  {String(step.actorIds.length)}/{String(users.length)}
                </span>
              </label>
              {steps.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => { onChange(
                      steps
                        .filter((_, index) => index !== stepIndex)
                        .map((item, index) => ({ ...item, position: index + 1 })),
                    ); }
                  }
                  aria-label={t("adminFlows.stepRemove", { index: String(step.position) })}
                  data-testid={`${testIdPrefix}-step-remove-${String(stepIndex)}`}
                >
                  <Trash2 />
                </Button>
              )}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {users.map((user) => {
              const checked = step.actorIds.includes(user.id);
              return (
                <label
                  key={user.id}
                  className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    checked ? "bg-secondary" : ""
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      onChange(
                        steps.map((item, index) =>
                          index === stepIndex
                            ? {
                                ...item,
                                actorIds: value
                                  ? [...item.actorIds, user.id]
                                  : item.actorIds.filter((id) => id !== user.id),
                              }
                            : item,
                        ),
                      );
                    }}
                    data-testid={`${testIdPrefix}-step-${String(stepIndex)}-actor-${user.id}`}
                  />
                  {user.display_name}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActorPicker({
  label,
  users,
  selected,
  onChange,
  testIdPrefix,
}: {
  label: string;
  users: User[];
  selected: string[];
  onChange: (ids: string[]) => void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{label}</Label>
        <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
          <Checkbox
            checked={selected.length > 0 && selected.length === users.length}
            indeterminate={selected.length > 0 && selected.length < users.length}
            onCheckedChange={() => {
              onChange(selected.length === users.length ? [] : users.map((user) => user.id));
            }}
            data-testid={`${testIdPrefix}-select-all`}
          />
          {t("adminFlows.selectAll")}
          <span className="tabular-nums" data-testid={`${testIdPrefix}-select-all-count`}>
            {String(selected.length)}/{String(users.length)}
          </span>
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {users.map((user) => {
          const checked = selected.includes(user.id);
          return (
            <label
              key={user.id}
              className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                checked ? "bg-secondary" : ""
              }`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => {
                  onChange(
                    value ? [...selected, user.id] : selected.filter((id) => id !== user.id),
                  );
                }}
                data-testid={`${testIdPrefix}-actor-${user.id}`}
              />
              {user.display_name}
            </label>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{t("adminFlows.actorHint")}</p>
    </div>
  );
}

function MaskingRulesSection({ flow }: { flow: Flow }) {
  const { t } = useTranslation();
  const rulesQuery = useFlowMaskingRules(flow.id, true);
  const replaceRule = useReplaceMaskingRule();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedFor, setSavedFor] = useState<Record<string, string>>({});
  const [errorText, setErrorText] = useState<string | null>(null);

  const fetched: FlowMaskingRule[] = rulesQuery.data ?? [];
  // 词表按流程的每个数据源配置（OpenAPI：per datasource of the flow），但后端只返回
  // 已存在的规则行；未配置的数据源在此补空行，否则首条规则在 UI 上无从创建。
  const capabilities = flow.query_capabilities ?? [];
  const rules: { datasource_id: string; datasource_name?: string; sensitive_columns: string[] }[] = [
    ...capabilities.map((capability) => {
      const existing = fetched.find((rule) => rule.datasource_id === capability.datasource_id);
      return { datasource_id: capability.datasource_id, datasource_name: capability.datasource_name, sensitive_columns: existing?.sensitive_columns ?? [] };
    }),
    ...fetched.filter((rule) => !capabilities.some((capability) => capability.datasource_id === rule.datasource_id)),
  ];

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="flow-masking-rules">
      <div className="flex items-center gap-2">
        <EyeOff className="size-4" />
        <Label>{t("adminFlows.maskingRules")}</Label>
      </div>
      <p className="text-muted-foreground text-xs">{t("adminFlows.maskingRulesHint")}</p>
      {rulesQuery.isPending && <LoadingState variant="inline" />}
      {rules.map((rule) => {
        const value = draft[rule.datasource_id] ?? rule.sensitive_columns.join(", ");
        const savedValue = savedFor[rule.datasource_id] ?? rule.sensitive_columns.join(", ");
        const dirty = value !== savedValue;
        return (
          <div key={rule.datasource_id} className="flex flex-col gap-1">
            <span className="font-mono text-xs">{rule.datasource_name ?? rule.datasource_id}</span>
            <div className="flex items-center gap-2">
              <Textarea
                value={value}
                onChange={(event) => { setDraft((current) => ({ ...current, [rule.datasource_id]: event.target.value })); }}
                className="min-h-8 text-xs"
                data-testid={`flow-masking-rule-${rule.datasource_id}`}
              />
              <PendingButton
                size="sm"
                variant="outline"
                pending={replaceRule.isPending}
                disabled={!dirty}
                onClick={() => {
                  setErrorText(null);
                  const columns = value
                    .split(",")
                    .map((column) => column.trim())
                    .filter((column) => column !== "");
                  replaceRule.mutate(
                    { flowId: flow.id, datasourceId: rule.datasource_id, body: { sensitive_columns: columns } },
                    {
                      onSuccess: () => { setSavedFor((current) => ({ ...current, [rule.datasource_id]: value })); },
                      onError: (error) => { setErrorText(describeErrorText(describeError(error, "replaceFlowMaskingRule"))); },
                    },
                  );
                }}
                data-testid={`flow-masking-save-${rule.datasource_id}`}
              >
                {t("common.save")}
              </PendingButton>
            </div>
          </div>
        );
      })}
      {errorText !== null && (
        <Alert variant="destructive">
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
