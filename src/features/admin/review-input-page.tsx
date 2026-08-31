import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle, Plus, Trash2, Play, Lock } from "lucide-react";
import type {
  KnowledgeEntry,
  KnowledgeEntryEvaluation,
  KnowledgeEntryWrite,
  PromptTool,
  PromptToolWrite,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useCreateKnowledgeEntry,
  useCreatePromptTool,
  useDatasources,
  useDeleteKnowledgeEntry,
  useDeletePromptTool,
  useEvaluateKnowledgeEntry,
  useKnowledgeEntries,
  usePromptTools,
  useReplaceKnowledgeEntry,
  useReplacePromptTool,
} from "@/features/admin/use-admin";
import {
  ReviewInputDefinitionEditor,
  type ReviewInputEditorValue,
} from "@/features/admin/review-input-editor";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
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
 * Shared lifecycle page for the two governed review inputs (migration
 * contract §9.2 review-engine entries): skills (/admin/review-engine/skills,
 * PromptTool) and internal experience (/admin/review-engine/knowledge,
 * KnowledgeEntry). Both follow the identical Draft/Enabled/Disabled
 * lifecycle with an immutable config_hash per save; every save re-hashes the
 * definition, and a changed hash makes every unsubmitted review that
 * references the old hash outdated while submitted orders keep their frozen
 * snapshot. Binding to flows/rule sets happens elsewhere (flow editor F10 /
 * rule-set page) — this surface renders reverse references only.
 *
 * B13 alignment: PromptTool views carry is_builtin — built-in rows render a
 * lock badge, their definition face (name/engine/definition/parameter keys)
 * is locked in the editor and only the state stays toggleable, and delete is
 * disabled with an inline explanation (the backend refuses both). The skills
 * Eval gate runs at save time (RCP-20260831 ruling 4): enabling a skill
 * evaluates inline inside create/replace, a failing gate blocks the save and
 * renders the business error in place — the page offers no separate Eval
 * entry or result column (knowledge entries keep their declared evaluations
 * endpoint).
 */

const STATE_ORDER = ["draft", "enabled", "disabled"] as const;
type InputState = (typeof STATE_ORDER)[number];

interface ReviewInputFormState {
  name: string;
  state: InputState;
  engine: "all" | "mysql" | "postgresql";
  purpose: string;
  scopeType: "global" | "datasource" | "table";
  datasourceId: string;
  databaseName: string;
  tableName: string;
  editor: ReviewInputEditorValue;
}

function emptyForm(): ReviewInputFormState {
  return {
    name: "",
    state: "draft",
    engine: "all",
    purpose: "",
    scopeType: "global",
    datasourceId: "",
    databaseName: "",
    tableName: "",
    editor: {
      definition: {
        knowledge_text: "",
        finding_template: {},
        severity_whitelist: ["medium"],
        version: 1,
      },
      parameters: {},
    },
  };
}

function formForTool(tool: PromptTool): ReviewInputFormState {
  return {
    name: tool.name,
    state: tool.state,
    engine: tool.engine,
    purpose: "",
    scopeType: "global",
    datasourceId: "",
    databaseName: "",
    tableName: "",
    editor: { definition: tool.definition, parameters: tool.parameters ?? {} },
  };
}

function formForEntry(entry: KnowledgeEntry): ReviewInputFormState {
  return {
    name: entry.name,
    state: entry.state,
    engine: "all",
    purpose: entry.purpose ?? "",
    scopeType: entry.scope_type,
    datasourceId: entry.datasource_id ?? "",
    databaseName: entry.database_name ?? "",
    tableName: entry.table_name ?? "",
    editor: { definition: entry.definition, parameters: {} },
  };
}

function StateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  const variant = state === "enabled" ? "default" : state === "draft" ? "secondary" : "outline";
  return (
    <Badge variant={variant} data-testid="review-input-state">
      {t(`admin.reviewInput.state_${state}`)}
    </Badge>
  );
}

export function ReviewInputListPage({ kind }: { kind: "skills" | "knowledge" }) {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const toolsQuery = usePromptTools(enabled && kind === "skills");
  const entriesQuery = useKnowledgeEntries(enabled && kind === "knowledge");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTool | KnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState<PromptTool | KnowledgeEntry | null>(null);
  const [evaluating, setEvaluating] = useState<KnowledgeEntry | null>(null);
  const [evalResult, setEvalResult] = useState<KnowledgeEntryEvaluation | null>(null);
  const [evalErrorKey, setEvalErrorKey] = useState<string | null>(null);
  const evaluateMutation = useEvaluateKnowledgeEntry();

  const rows = kind === "skills" ? (toolsQuery.data ?? []) : (entriesQuery.data ?? []);
  const loading = kind === "skills" ? toolsQuery.isPending : entriesQuery.isPending;
  const errored = kind === "skills" ? toolsQuery.isError : entriesQuery.isError;
  const refetch = kind === "skills" ? toolsQuery.refetch : entriesQuery.refetch;

  const isSkills = kind === "skills";

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t(isSkills ? "nav.reviewEngine.skills" : "nav.reviewEngine.knowledge")} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t(isSkills ? "admin.skills.title" : "admin.knowledge.title")}</CardTitle>
            <CardDescription>
              {t(isSkills ? "admin.skills.description" : "admin.knowledge.description")}
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="review-input-create"
          >
            <Plus /> {t(isSkills ? "admin.skills.createTitle" : "admin.knowledge.createTitle")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {evalErrorKey !== null ? (
            <Alert variant="destructive" data-testid="knowledge-eval-error">
              <AlertTitle>{t(evalErrorKey)}</AlertTitle>
            </Alert>
          ) : null}
          <Alert className="border-[var(--risk-warning)]/40" data-testid="review-input-outdated-note">
            <AlertTitle>{t("admin.reviewInput.outdatedNoteTitle")}</AlertTitle>
            <AlertDescription>{t("admin.reviewInput.outdatedNoteBody")}</AlertDescription>
          </Alert>
          {loading ? (
            <LoadingState />
          ) : errored ? (
            <ErrorState error={isSkills ? toolsQuery.error : entriesQuery.error} operationId={isSkills ? "listPromptTools" : "listKnowledgeEntries"} onRetry={() => void refetch()} />
          ) : rows.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Puzzle />
                </EmptyMedia>
                <EmptyTitle>
                  {t(isSkills ? "admin.skills.emptyTitle" : "admin.knowledge.emptyTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {t(isSkills ? "admin.skills.emptyDescription" : "admin.knowledge.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.reviewInput.name")}</TableHead>
                  {isSkills ? null : <TableHead>{t("admin.knowledge.scope")}</TableHead>}
                  <TableHead>{t("admin.reviewInput.state")}</TableHead>
                  <TableHead>{t("admin.reviewInput.configHash")}</TableHead>
                  {isSkills ? null : <TableHead>{t("admin.knowledge.provenance")}</TableHead>}
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const id = row.id;
                  const name = row.name;
                  const state = row.state;
                  const configHash = row.config_hash;
                  const entry = isSkills ? null : (row as KnowledgeEntry);
                  const builtin = isSkills && (row as PromptTool).is_builtin;
                  return (
                    <TableRow key={id} data-testid={`review-input-row-${id}`}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1.5">
                          {name}
                          {builtin ? (
                            <Badge variant="outline" data-testid={`review-input-builtin-${id}`}>
                              <Lock /> {t("admin.skills.builtinBadge")}
                            </Badge>
                          ) : null}
                        </span>
                        {builtin ? (
                          <div className="text-muted-foreground text-xs">{t("admin.skills.builtinHint")}</div>
                        ) : null}
                        {entry !== null && entry.purpose ? (
                          <div className="text-muted-foreground text-xs">{entry.purpose}</div>
                        ) : null}
                      </TableCell>
                      {isSkills ? null : (
                        <TableCell className="text-xs">
                          {entry !== null ? (
                            entry.scope_type === "global" ? (
                              t("admin.knowledge.scopeGlobal")
                            ) : entry.scope_type === "datasource" ? (
                              t("admin.knowledge.scopeDatasource")
                            ) : (
                              `${entry.database_name ?? "?"}.${entry.table_name ?? "?"}`
                            )
                          ) : null}
                        </TableCell>
                      )}
                      <TableCell>
                        <StateBadge state={state} />
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid="review-input-hash">
                        {configHash}
                      </TableCell>
                      {isSkills ? null : (
                        <TableCell>
                          {entry !== null ? (
                            <Badge variant={entry.provenance === "manual" ? "secondary" : "outline"}>
                              {t(`admin.knowledge.provenance_${entry.provenance}`)}
                            </Badge>
                          ) : null}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {isSkills ? null : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={evaluateMutation.isPending}
                              onClick={() => {
                                setEvalErrorKey(null);
                                evaluateMutation.mutate(
                                  { id },
                                  {
                                    onSuccess: (result) => {
                                      setEvaluating(row as KnowledgeEntry);
                                      setEvalResult(result);
                                    },
                                    onError: (error) => {
                                      const display = describeError(error, "evaluateKnowledgeEntry");
                                      setEvalErrorKey(display.messageKey);
                                    },
                                  },
                                );
                              }}
                              data-testid={`review-input-evaluate-${id}`}
                            >
                              <Play /> {t("admin.knowledge.evaluate")}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                              setDialogOpen(true);
                            }}
                            data-testid={`review-input-edit-${id}`}
                          >
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setDeleting(row); }}
                            disabled={builtin}
                            data-testid={`review-input-delete-${id}`}
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
        <ReviewInputDialog
          key={editing?.id ?? "new"}
          kind={kind}
          editing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      {deleting !== null ? (
        <DeleteReviewInputDialog
          key={deleting.id}
          kind={kind}
          target={deleting}
          onClose={() => { setDeleting(null); }}
        />
      ) : null}

      <Dialog
        open={evaluating !== null}
        onOpenChange={(next) => { if (!next) setEvaluating(null); }}
      >
        <DialogContent data-testid="knowledge-eval-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("admin.knowledge.evalTitle", { name: evaluating?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("admin.knowledge.evalDescription")}</DialogDescription>
          </DialogHeader>
          {evalResult !== null ? (
            <div className="flex flex-col gap-2" data-testid="knowledge-eval-result">
              <div className="flex gap-1.5">
                <Badge variant={evalResult.pass ? "default" : "destructive"}>
                  {evalResult.pass ? t("admin.knowledge.evalPass") : t("admin.knowledge.evalFail")}
                </Badge>
                <Badge variant={evalResult.schema_subset_ok ? "secondary" : "destructive"}>
                  {t("admin.knowledge.evalSchema")}
                </Badge>
                <Badge variant={evalResult.privacy_ok ? "secondary" : "destructive"}>
                  {t("admin.knowledge.evalPrivacy")}
                </Badge>
                <Badge variant={evalResult.injection_ok ? "secondary" : "destructive"}>
                  {t("admin.knowledge.evalInjection")}
                </Badge>
                <Badge variant={evalResult.severity_ok ? "secondary" : "destructive"}>
                  {t("admin.knowledge.evalSeverity")}
                </Badge>
              </div>
              {evalResult.findings !== undefined && evalResult.findings.length > 0 ? (
                <ul className="text-destructive list-disc pl-4 text-xs">
                  {evalResult.findings.map((finding) => (
                    <li key={finding}>{finding}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => { setEvaluating(null); }}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewInputDialog({
  kind,
  editing,
  onClose,
}: {
  kind: "skills" | "knowledge";
  editing: PromptTool | KnowledgeEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isSkills = kind === "skills";
  // Built-in skills are system-owned (B13 is_builtin): the definition face
  // arrives locked and the submit can only carry a state change.
  const editingBuiltin = isSkills && editing !== null && (editing as PromptTool).is_builtin;
  const createTool = useCreatePromptTool();
  const replaceTool = useReplacePromptTool();
  const createEntry = useCreateKnowledgeEntry();
  const replaceEntry = useReplaceKnowledgeEntry();
  const session = useSession();
  const datasourcesQuery = useDatasources(!isSkills && session.user?.can_access_admin === true);
  // Keyed per open by the parent: state initializes from the edited row.
  const [form, setForm] = useState<ReviewInputFormState>(() =>
    editing === null
      ? emptyForm()
      : isSkills
        ? formForTool(editing as PromptTool)
        : formForEntry(editing as KnowledgeEntry),
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  const mutation = isSkills
    ? editing === null
      ? createTool
      : replaceTool
    : editing === null
      ? createEntry
      : replaceEntry;

  const submit = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    if (isSkills) {
      const write: PromptToolWrite = {
        name: form.name,
        state: form.state,
        engine: form.engine,
        parameters: form.editor.parameters,
        definition: form.editor.definition,
      };
      if (editing === null) {
        createTool.mutate(write, { onSuccess: onClose, onError: onWriteError("createPromptTool") });
      } else {
        replaceTool.mutate(
          { id: editing.id, version: editing.version, write },
          { onSuccess: onClose, onError: onWriteError("replacePromptTool") },
        );
      }
    } else {
      const write: KnowledgeEntryWrite = {
        name: form.name,
        purpose: form.purpose === "" ? undefined : form.purpose,
        state: form.state,
        scope_type: form.scopeType,
        datasource_id: form.scopeType === "global" ? undefined : form.datasourceId === "" ? undefined : form.datasourceId,
        database_name: form.databaseName === "" ? undefined : form.databaseName,
        table_name: form.tableName === "" ? undefined : form.tableName,
        definition: form.editor.definition,
        provenance: editing !== null && "provenance" in editing ? editing.provenance : "manual",
        source_finding_id:
          editing !== null && "source_finding_id" in editing
            ? (editing).source_finding_id ?? undefined
            : undefined,
      };
      if (editing === null) {
        createEntry.mutate(write, { onSuccess: onClose, onError: onWriteError("createKnowledgeEntry") });
      } else {
        replaceEntry.mutate(
          { id: editing.id, version: editing.version, write },
          { onSuccess: onClose, onError: onWriteError("replaceKnowledgeEntry") },
        );
      }
    }
  };

  const onWriteError = (operationId: string) => (error: unknown) => {
    const display = describeError(error, operationId);
    setErrorKey(display.messageKey);
    setErrorRequestId(display.requestId);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null
              ? t(isSkills ? "admin.skills.createTitle" : "admin.knowledge.createTitle")
              : t(isSkills ? "admin.skills.editTitle" : "admin.knowledge.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.reviewInput.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {editingBuiltin ? (
            <Alert data-testid="review-input-builtin-notice">
              <AlertTitle>{t("admin.skills.builtinDialogTitle")}</AlertTitle>
              <AlertDescription>{t("admin.skills.builtinDialogBody")}</AlertDescription>
            </Alert>
          ) : null}
          {isSkills ? (
            <p className="text-muted-foreground text-xs" data-testid="skills-eval-gate-hint">
              {t("admin.skills.evalGateHint")}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="review-input-name">{t("admin.reviewInput.name")}</Label>
              <Input
                id="review-input-name"
                value={form.name}
                onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
                disabled={editingBuiltin}
                data-testid="review-input-name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("admin.reviewInput.state")}</Label>
              <Select
                value={form.state}
                onValueChange={(next) => {
                  if (next === null) return;
                  setForm({ ...form, state: next });
                }}
              >
                <SelectTrigger data-testid="review-input-state-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATE_ORDER.map((state) => (
                    <SelectItem key={state} value={state}>
                      {t(`admin.reviewInput.state_${state}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isSkills ? (
              <div className="flex flex-col gap-1">
                <Label>{t("admin.skills.engine")}</Label>
                <Select
                  value={form.engine}
                  onValueChange={(next) => {
                    if (next === null) return;
                    setForm({ ...form, engine: next });
                  }}
                >
                  <SelectTrigger data-testid="review-input-engine" disabled={editingBuiltin}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all</SelectItem>
                    <SelectItem value="mysql">mysql</SelectItem>
                    <SelectItem value="postgresql">postgresql</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Label>{t("admin.knowledge.scope")}</Label>
                  <Select
                    value={form.scopeType}
                    onValueChange={(next) => {
                      if (next === null) return;
                      setForm({ ...form, scopeType: next });
                    }}
                  >
                    <SelectTrigger data-testid="knowledge-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">{t("admin.knowledge.scopeGlobal")}</SelectItem>
                      <SelectItem value="datasource">{t("admin.knowledge.scopeDatasource")}</SelectItem>
                      <SelectItem value="table">{t("admin.knowledge.scopeTable")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="knowledge-purpose">{t("admin.knowledge.purpose")}</Label>
                  <Input
                    id="knowledge-purpose"
                    value={form.purpose}
                    onChange={(event) => { setForm({ ...form, purpose: event.target.value }); }}
                    data-testid="knowledge-purpose"
                  />
                </div>
                {form.scopeType !== "global" ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label>{t("admin.knowledge.datasource")}</Label>
                      <Select
                        value={form.datasourceId}
                        onValueChange={(next) => {
                          if (next === null) return;
                          setForm({ ...form, datasourceId: next });
                        }}
                      >
                        <SelectTrigger data-testid="knowledge-datasource">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(datasourcesQuery.data ?? []).map((datasource: { id: string; name: string }) => (
                            <SelectItem key={datasource.id} value={datasource.id}>
                              {datasource.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="knowledge-database">{t("admin.knowledge.databaseName")}</Label>
                      <Input
                        id="knowledge-database"
                        value={form.databaseName}
                        onChange={(event) => { setForm({ ...form, databaseName: event.target.value }); }}
                        data-testid="knowledge-database"
                      />
                    </div>
                  </>
                ) : null}
                {form.scopeType === "table" ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="knowledge-table">{t("admin.knowledge.tableName")}</Label>
                    <Input
                      id="knowledge-table"
                      value={form.tableName}
                      onChange={(event) => { setForm({ ...form, tableName: event.target.value }); }}
                      data-testid="knowledge-table"
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
          <ReviewInputDefinitionEditor
            value={form.editor}
            onChange={(next) => { setForm({ ...form, editor: next }); }}
            disabled={editingBuiltin}
          />
          {errorKey !== null ? (
            <Alert variant="destructive" data-testid="review-input-error">
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
          <Button onClick={submit} disabled={mutation.isPending} data-testid="review-input-submit">
            {mutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteReviewInputDialog({
  kind,
  target,
  onClose,
}: {
  kind: "skills" | "knowledge";
  target: PromptTool | KnowledgeEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isSkills = kind === "skills";
  const deleteTool = useDeletePromptTool();
  const deleteEntry = useDeleteKnowledgeEntry();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const mutation = isSkills ? deleteTool : deleteEntry;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.reviewInput.deleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("admin.reviewInput.deleteDescription", { name: target.name })}
          </DialogDescription>
        </DialogHeader>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="review-input-delete-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>{t("admin.reviewInput.deleteErrorHint")}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => { mutation.mutate(
                { id: target.id, version: target.version },
                {
                  onSuccess: onClose,
                  onError: (error) => {
                    const display = describeError(error, isSkills ? "deletePromptTool" : "deleteKnowledgeEntry");
                    setErrorKey(display.messageKey);
                  },
                },
              ); }
            }
            data-testid="review-input-delete-confirm"
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
