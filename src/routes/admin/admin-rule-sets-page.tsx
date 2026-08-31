import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Plus, Trash2 } from "lucide-react";
import type { RuleSet, RuleSetWrite } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useCreateRuleSet,
  useDeleteRuleSet,
  useFlowsForRuleSetImpact,
  usePromptTools,
  useReplaceRuleSet,
  useRuleSets,
} from "@/features/admin/use-admin";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

/**
 * Rule Set 组合管理 (route /admin/rule-sets; migration contract §2 maps the
 * legacy /manager/rules here). In v4 a rule set is a PURE prompt-tool
 * combination — rule_sets.rules is structurally an empty object and the old
 * ~50-knob DML/DDL catalog has no v4 equivalent (the built-in lexical checks
 * ship as builtin skills; the legacy rule_id-per-datasource binding is gone).
 * The page therefore edits exactly: name, enabled, prompt_tool_ids.
 *
 * 影响预览 (deliverable): editing a rule set re-hashes its config; every
 * unsubmitted review referencing the old hash becomes outdated while
 * submitted orders keep their frozen snapshot. The dialog renders the
 * reverse visibility — which flows currently bind this rule set (binding
 * itself happens on the flow editor, F10) — and the hash-change warning.
 * Draft skills cannot be bound (UI spec §5.3) — the picker marks them.
 */

interface RuleSetFormState {
  name: string;
  enabled: boolean;
  toolIds: string[];
}

function RuleSetFormDialog({
  editing,
  onClose,
}: {
  editing: RuleSet | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const toolsQuery = usePromptTools(session.user?.can_access_admin === true);
  const flowsQuery = useFlowsForRuleSetImpact(session.user?.can_access_admin === true);
  const createMutation = useCreateRuleSet();
  const replaceMutation = useReplaceRuleSet();
  // Keyed per open by the parent: state initializes from the edited row.
  const [form, setForm] = useState<RuleSetFormState>(() =>
    editing === null
      ? { name: "", enabled: true, toolIds: [] }
      : { name: editing.name, enabled: editing.enabled, toolIds: [...editing.prompt_tool_ids] },
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  const bindingFlows = useMemo(
    () =>
      editing === null
        ? []
        : (flowsQuery.data ?? []).filter((flow) => flow.rule_set_id === editing.id),
    [editing, flowsQuery.data],
  );
  const bindingWillChange = useMemo(
    () => editing !== null && JSON.stringify([...editing.prompt_tool_ids].sort()) !== JSON.stringify([...form.toolIds].sort()),
    [editing, form.toolIds],
  );

  const toggleTool = (toolId: string) => {
    setForm((current) => ({
      ...current,
      toolIds: current.toolIds.includes(toolId)
        ? current.toolIds.filter((id) => id !== toolId)
        : [...current.toolIds, toolId],
    }));
  };

  const submit = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    const write: RuleSetWrite = {
      name: form.name,
      enabled: form.enabled,
      // Pure prompt-tool combination: the rules object is structurally
      // empty in v4 (ai-review-production PRD 9.3.1).
      rules: {},
      prompt_tool_ids: form.toolIds,
    };
    if (editing === null) {
      createMutation.mutate(write, {
        onSuccess: onClose,
        onError: (error) => {
          const display = describeError(error, "createRuleSet");
          setErrorKey(display.messageKey);
          setErrorRequestId(display.requestId);
        },
      });
    } else {
      replaceMutation.mutate(
        { id: editing.id, version: editing.version, write },
        {
          onSuccess: onClose,
          onError: (error) => {
            const display = describeError(error, "replaceRuleSet");
            setErrorKey(display.messageKey);
            setErrorRequestId(display.requestId);
          },
        },
      );
    }
  };

  const mutation = editing === null ? createMutation : replaceMutation;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? t("admin.ruleSets.createTitle") : t("admin.ruleSets.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.ruleSets.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-set-name">{t("admin.ruleSets.name")}</Label>
              <Input
                id="rule-set-name"
                value={form.name}
                onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
                data-testid="rule-set-name"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rule-set-enabled"
                checked={form.enabled}
                onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); }}
                className="size-4"
                data-testid="rule-set-enabled"
              />
              <Label htmlFor="rule-set-enabled" className="cursor-pointer">
                {t("admin.ruleSets.enabled")}
              </Label>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("admin.ruleSets.toolsTitle")}</Label>
            {toolsQuery.isPending ? (
              <LoadingState />
            ) : (
              <div className="flex flex-col gap-1.5" data-testid="rule-set-tools">
                {(toolsQuery.data ?? []).map((tool) => {
                  const bindable = tool.state === "enabled" || tool.state === "disabled";
                  const selected = form.toolIds.includes(tool.id);
                  return (
                    <label
                      key={tool.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 ${
                        bindable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                      }`}
                      data-testid={`rule-set-tool-option-${tool.id}`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => { if (bindable) toggleTool(tool.id); }}
                          disabled={!bindable}
                          className="size-4"
                        />
                        <span className="text-sm font-medium">{tool.name}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {tool.config_hash}
                        </Badge>
                        <Badge variant={tool.state === "enabled" ? "default" : "secondary"}>
                          {t(`admin.reviewInput.state_${tool.state}`)}
                        </Badge>
                        {bindable ? null : (
                          <Badge variant="destructive">{t("admin.ruleSets.draftNotBindable")}</Badge>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          {editing !== null ? (
            <div className="rounded-lg border p-3" data-testid="rule-set-impact-preview">
              <p className="text-sm font-medium">{t("admin.ruleSets.impactTitle")}</p>
              <p className="text-muted-foreground mt-1 text-xs">{t("admin.ruleSets.impactHashNote")}</p>
              <p className="mt-2 text-xs">
                {t("admin.ruleSets.boundFlows", { count: bindingFlows.length })}:{" "}
                {bindingFlows.length === 0 ? (
                  <span className="text-muted-foreground">{t("admin.ruleSets.noBoundFlows")}</span>
                ) : (
                  bindingFlows.map((flow) => flow.name).join(", ")
                )}
              </p>
              {bindingWillChange ? (
                <p className="mt-1 text-xs text-[var(--risk-warning)]">
                  {t("admin.ruleSets.bindingChangeNote")}
                </p>
              ) : null}
            </div>
          ) : null}
          {errorKey !== null ? (
            <Alert variant="destructive" data-testid="rule-set-error">
              <AlertTitle>{t(errorKey)}</AlertTitle>
              <AlertDescription>
                {errorRequestId !== null ? `request_id: ${errorRequestId}` : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending} data-testid="rule-set-submit">
            {mutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminRuleSetsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const query = useRuleSets(enabled);
  const flowsQuery = useFlowsForRuleSetImpact(enabled);
  const toolsQuery = usePromptTools(enabled);
  const [editing, setEditing] = useState<RuleSet | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<RuleSet | null>(null);
  const deleteMutation = useDeleteRuleSet();
  const [deleteErrorKey, setDeleteErrorKey] = useState<string | null>(null);

  const toolName = (toolId: string) =>
    (toolsQuery.data ?? []).find((tool) => tool.id === toolId)?.name ?? toolId;

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("admin.ruleSets.title")} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("admin.ruleSets.title")}</CardTitle>
            <CardDescription>{t("admin.ruleSets.description")}</CardDescription>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="rule-set-create"
          >
            <Plus /> {t("admin.ruleSets.createTitle")}
          </Button>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} operationId="listRuleSets" onRetry={() => void query.refetch()} />
          ) : query.data.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Layers />
                </EmptyMedia>
                <EmptyTitle>{t("admin.ruleSets.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("admin.ruleSets.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.ruleSets.name")}</TableHead>
                  <TableHead>{t("admin.ruleSets.toolsTitle")}</TableHead>
                  <TableHead>{t("admin.reviewInput.configHash")}</TableHead>
                  <TableHead>{t("admin.ruleSets.boundFlowsColumn")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((ruleSet) => {
                  const boundFlows = (flowsQuery.data ?? []).filter(
                    (flow) => flow.rule_set_id === ruleSet.id,
                  );
                  return (
                    <TableRow key={ruleSet.id} data-testid={`rule-set-row-${ruleSet.id}`}>
                      <TableCell className="font-medium">
                        {ruleSet.name}
                        {ruleSet.enabled ? null : (
                          <Badge variant="outline" className="ml-2">
                            {t("admin.ruleSets.disabled")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {ruleSet.prompt_tool_ids.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                              {t("admin.ruleSets.noTools")}
                            </span>
                          ) : (
                            ruleSet.prompt_tool_ids.map((toolId) => (
                              <Badge key={toolId} variant="secondary" data-testid="rule-set-tool-chip">
                                {toolName(toolId)}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid="rule-set-hash">
                        {ruleSet.config_hash}
                      </TableCell>
                      <TableCell className="text-xs">
                        {boundFlows.length === 0 ? (
                          <span className="text-muted-foreground">{t("admin.ruleSets.noBoundFlows")}</span>
                        ) : (
                          boundFlows.map((flow) => flow.name).join(", ")
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(ruleSet);
                              setDialogOpen(true);
                            }}
                            data-testid={`rule-set-edit-${ruleSet.id}`}
                          >
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deleteMutation.isPending || boundFlows.length > 0}
                            title={
                              boundFlows.length > 0 ? t("admin.ruleSets.deleteBlockedHint") : undefined
                            }
                            onClick={() => { setDeleting(ruleSet); }}
                            data-testid={`rule-set-delete-${ruleSet.id}`}
                          >
                            <Trash2 /> {t("common.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {dialogOpen ? (
        <RuleSetFormDialog
          key={editing?.id ?? "new"}
          editing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
      {deleting !== null ? (
        <Dialog open onOpenChange={(next) => { if (!next) setDeleting(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("admin.ruleSets.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("admin.ruleSets.deleteDescription", { name: deleting.name })}
              </DialogDescription>
            </DialogHeader>
            {deleteErrorKey !== null ? (
              <Alert variant="destructive" data-testid="rule-set-delete-error">
                <AlertTitle>{t(deleteErrorKey)}</AlertTitle>
                <AlertDescription>{t("admin.reviewInput.deleteErrorHint")}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDeleting(null); }}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => { deleteMutation.mutate(
                    { id: deleting.id, version: deleting.version },
                    {
                      onSuccess: () => { setDeleting(null); },
                      onError: (error) => {
                        const display = describeError(error, "deleteRuleSet");
                        setDeleteErrorKey(display.messageKey);
                      },
                    },
                  ); }
                }
                data-testid="rule-set-delete-confirm"
              >
                {t("common.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
