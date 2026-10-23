import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/shared/components/ui/alert-dialog";
import { Menu } from "lucide-react";
import { Sheet, SheetContent } from "@/shared/components/ui/sheet";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { Pencil, Puzzle, Plus, Trash2, Play, Lock, Search } from "lucide-react";
import { Checkbox } from "@/shared/components/ui/checkbox";
import type {
  KnowledgeEntry,
  KnowledgeEntryEvaluation,
  KnowledgeEntryWrite,
  PromptTool,
  PromptToolWrite,
  PromptToolWriteParameters,
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
import { renderSkillDescription } from "@/features/admin/skill-description";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { TableSearchInput } from "@/shared/components/table-search-input";
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
  description: string;
  state: InputState;
  engine: "all" | "mysql" | "postgresql";
  purpose: string;
  scopeType: "global" | "datasource" | "table";
  datasourceId: string;
  databaseName: string;
  tableName: string;
  /** §18.81：可调参数值的字符串草稿（键集与类型跟随行内，仅值可编辑）。 */
  paramDrafts: Record<string, string>;
  editor: ReviewInputEditorValue;
}

// §18.80：技能说明上限（与OpenAPI PromptToolWrite.description maxLength
// 一致，按Unicode字符计）。
const MAX_SKILL_DESCRIPTION = 100;

// §18.81（owner裁定）：内置技能提示词锁定不动，但提示词中{{变量}}的
// 具体值开放调整。草稿以字符串承载，提交时按行内值的类型还原——
// 类型与键集由构造保证不漂移，后端键集+类型比对仍兜底（B8治理三分）。
export function stringifyParamDrafts(params: PromptToolWriteParameters): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "boolean") drafts[key] = value ? "true" : "false";
    else if (Array.isArray(value)) drafts[key] = value.join(", ");
    else drafts[key] = String(value);
  }
  return drafts;
}

export function convertParamDrafts(
  drafts: Record<string, string>,
  template: PromptToolWriteParameters,
): PromptToolWriteParameters | null {
  const out: PromptToolWriteParameters = {};
  for (const [key, raw] of Object.entries(drafts)) {
    const sample = template[key];
    if (typeof sample === "number") {
      const parsed = Number(raw);
      if (raw.trim() === "" || !Number.isInteger(parsed) || parsed < 1 || parsed > 1e15) return null;
      out[key] = parsed;
    } else if (typeof sample === "boolean") {
      out[key] = raw === "true";
    } else if (Array.isArray(sample)) {
      const items = raw.split(",").map((item) => item.trim()).filter((item) => item !== "");
      if (items.length > 16 || items.some((item) => item.length > 64)) return null;
      out[key] = items;
    } else {
      if (raw.trim() === "" || raw.length > 128) return null;
      out[key] = raw;
    }
  }
  return out;
}

export function paramTypeKey(value: number | string | boolean | string[]): string {
  if (typeof value === "number") return "paramTypeNumber";
  if (typeof value === "boolean") return "paramTypeBoolean";
  if (Array.isArray(value)) return "paramTypeStringList";
  return "paramTypeString";
}

function emptyForm(): ReviewInputFormState {
  return {
    name: "",
    description: "",
    state: "draft",
    engine: "all",
    purpose: "",
    scopeType: "global",
    datasourceId: "",
    databaseName: "",
    tableName: "",
    paramDrafts: {},
    editor: {
      definition: {
        knowledge_text: "",
        max_severity: "medium",
        version: 1,
      },
      parameters: {},
    },
  };
}

function formForTool(tool: PromptTool): ReviewInputFormState {
  return {
    name: tool.name,
    description: tool.description,
    state: tool.state,
    engine: tool.engine,
    purpose: "",
    scopeType: "global",
    datasourceId: "",
    databaseName: "",
    tableName: "",
    paramDrafts: stringifyParamDrafts(tool.parameters ?? {}),
    editor: { definition: tool.definition, parameters: tool.parameters ?? {} },
  };
}

function formForEntry(entry: KnowledgeEntry): ReviewInputFormState {
  return {
    name: entry.name,
    description: "",
    state: entry.state,
    engine: "all",
    purpose: entry.purpose ?? "",
    scopeType: entry.scope_type,
    datasourceId: entry.datasource_id ?? "",
    databaseName: "",
    tableName: "",
    paramDrafts: {},
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
  const [skillSearch, setSkillSearch] = useState("");
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  // §18.82：技能表格走后端游标分页（默认20行/页）；搜索变更回到第一页。
  const skillPager = useCursorPage(20);
  const skillKeyword = skillSearch.trim();
  useEffect(() => { skillPager.reset(); }, [skillKeyword]); // eslint-disable-line react-hooks/exhaustive-deps -- reset is intentional on keyword change
  // §18.73：技能/经验搜索走服务端q（名称子串）。
  const toolsQuery = usePromptTools(enabled && kind === "skills", {
    q: skillKeyword || undefined,
    limit: skillPager.pageSize,
    after: skillPager.after,
  });
  // 先于下方穷尽三元捕获，避免判别联合收窄泄漏进分页守卫（§18.82）。
  const toolsLoaded = !toolsQuery.isPending && !toolsQuery.isError;
  const entriesQuery = useKnowledgeEntries(enabled && kind === "knowledge", { q: knowledgeSearch.trim() || undefined });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTool | KnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState<PromptTool | KnowledgeEntry | null>(null);
  const [evaluating, setEvaluating] = useState<KnowledgeEntry | null>(null);
  const [evalResult, setEvalResult] = useState<KnowledgeEntryEvaluation | null>(null);
  const [evalErrorKey, setEvalErrorKey] = useState<string | null>(null);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [notesSheetOpen, setNotesSheetOpen] = useState(false);
  const [knowledgeTextDraft, setKnowledgeTextDraft] = useState<string | null>(null);
  const replaceEntry = useReplaceKnowledgeEntry();
  const evaluateMutation = useEvaluateKnowledgeEntry();

  const rows = kind === "skills" ? (toolsQuery.data?.items ?? []) : (entriesQuery.data?.items ?? []);
  const loading = kind === "skills" ? toolsQuery.isPending : entriesQuery.isPending;
  const errored = kind === "skills" ? toolsQuery.isError : entriesQuery.isError;
  const refetch = kind === "skills" ? toolsQuery.refetch : entriesQuery.refetch;

  const isSkills = kind === "skills";
  // §18.73：服务端q过滤后直接渲染；空态区分直接读skillSearch。
  const visibleSkillRows = rows;
  // 服务端 q 收窄结果集时，把幸存技能行的位移补间掉；翻页同理。
  const skillBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(visibleSkillRows.map((row) => row.id)),
  );

  // 内部经验 renders as the Notes-app master-detail (owner ruling 2026-09-02,
  // frozen template apps/notes): entry cards on the left, the experience
  // detail on the right. Skills keep the table view. All CRUD/evaluate
  // machinery is shared with the table branch below.
  if (!isSkills) {
    // §18.73：knowledgeSearch由服务端q消费，客户端不再过滤。
    const entries = entriesQuery.data?.items ?? [];
    const filtered = entries;
    const selected =
      filtered.find((entry) => entry.id === selectedKnowledgeId) ?? filtered[0] ?? null;
    const formatDate = (value: string): string =>
      value.replace("T", " ").replace("Z", " UTC");
    return (
      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <div className="flex min-h-[600px]">
            <div className="hidden w-80 shrink-0 flex-col gap-4 border-e border-border p-6 lg:flex">
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={knowledgeSearch}
                  onChange={(event) => { setKnowledgeSearch(event.target.value); }}
                  placeholder={t("admin.knowledge.searchPlaceholder")}
                  className="pl-9"
                  aria-label={t("admin.knowledge.searchPlaceholder")}
                  data-testid="knowledge-search"
                />
              </div>
              <h6 className="text-base">{t("admin.knowledge.allTitle")}</h6>
              <div className="flex flex-col gap-3 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-muted-foreground text-sm" data-testid="knowledge-notes-empty">
                    {t("admin.knowledge.emptyTitle")}
                  </p>
                ) : (
                  filtered.map((entry) => (
                    <div
                      key={entry.id}
                      data-testid={`review-input-row-${entry.id}`}
                      onClick={() => {
                        setSelectedKnowledgeId(entry.id);
                        setKnowledgeTextDraft(null);
                      }}
                      className={cn(
                        "cursor-pointer p-4 rounded-xl transition-[scale,opacity,background-color,border-color]",
                        entry.state === "disabled"
                          ? "bg-destructive/10 border border-destructive/20"
                          : entry.state === "draft"
                            ? "bg-muted/50 border border-border"
                            : "bg-chart-2/10 border border-chart-2/20",
                        selected?.id === entry.id
                          ? "scale-100 opacity-100"
                          : "scale-95 opacity-90",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <StateBadge state={entry.state} />
                        <span className="text-muted-foreground text-xs">
                          {t(`admin.knowledge.provenance_${entry.provenance}`)}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate font-medium text-primary">{entry.name}</p>
                      {entry.purpose ? (
                        <p className="text-muted-foreground truncate text-xs">{entry.purpose}</p>
                      ) : null}
                      <p className="text-muted-foreground mt-1 text-xs">
                        {entry.scope_type === "global"
                          ? t("admin.knowledge.scopeGlobal")
                          : entry.scope_type === "datasource"
                            ? t("admin.knowledge.scopeDatasource")
                            : `${entry.database_name ?? "?"}.${entry.table_name ?? "?"}`}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-muted-foreground text-xs">
                          {formatDate(entry.updated_at)}
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEvalErrorKey(null);
                              evaluateMutation.mutate(
                                { id: entry.id },
                                {
                                  onSuccess: (result) => {
                                    setEvaluating(entry);
                                    setEvalResult(result);
                                    setSelectedKnowledgeId(entry.id);
                                  },
                                  onError: (error) => {
                                    const display = describeError(error, "evaluateKnowledgeEntry");
                                    setEvalErrorKey(display.messageKey);
                                  },
                                },
                              );
                            }}
                            data-testid={`review-input-evaluate-${entry.id}`}
                          >
                            <Play /> {t("admin.knowledge.evaluate")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("common.edit")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(entry);
                              setDialogOpen(true);
                            }}
                            data-testid={`review-input-edit-${entry.id}`}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("common.delete")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleting(entry);
                            }}
                            data-testid={`review-input-delete-${entry.id}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="flex flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    aria-label={t("admin.knowledge.listLabel")}
                    data-testid="knowledge-list-open"
                    onClick={() => { setNotesSheetOpen(true); }}
                  >
                    <Menu className="size-4" aria-hidden />
                  </Button>
                  <h6 className="text-base">{t("admin.knowledge.editHeader")}</h6>
                </div>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                  data-testid="review-input-create"
                >
                  <Plus /> {t("admin.knowledge.createTitle")}
                </Button>
              </div>
              <div className="flex flex-1 flex-col gap-4 p-6">
                {evalErrorKey !== null ? (
                  <Alert variant="destructive" data-testid="knowledge-eval-error">
                    <AlertTitle>{t(evalErrorKey)}</AlertTitle>
                  </Alert>
                ) : null}
                {loading ? (
                  <LoadingState />
                ) : errored ? (
                  <ErrorState error={entriesQuery.error} operationId="listKnowledgeEntries" onRetry={() => void refetch()} />
                ) : selected === null ? (
                  <p className="text-muted-foreground text-sm">{t("admin.knowledge.emptyTitle")}</p>
                ) : (
                  <div className="flex flex-col gap-4" data-testid="knowledge-detail">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-xl font-semibold">{selected.name}</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditing(selected);
                          setDialogOpen(true);
                        }}
                        data-testid={`review-input-edit-${selected.id}`}
                      >
                        {t("admin.knowledge.editTitle")}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StateBadge state={selected.state} />
                      <Badge variant="outline">
                        {selected.scope_type === "global"
                          ? t("admin.knowledge.scopeGlobal")
                          : selected.scope_type === "datasource"
                            ? t("admin.knowledge.scopeDatasource")
                            : t("admin.knowledge.scopeTable")}
                      </Badge>
                      <Badge variant="secondary">
                        {t(`admin.knowledge.provenance_${selected.provenance}`)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {formatDate(selected.updated_at)}
                      </span>
                    </div>
                    {selected.purpose ? (
                      <p className="text-sm">{selected.purpose}</p>
                    ) : null}
                    {(() => {
                      const serverText = selected.definition.knowledge_text;
                      const draftText = knowledgeTextDraft ?? serverText;
                      const dirty = knowledgeTextDraft !== null && knowledgeTextDraft !== serverText;
                      const save = () => {
                        replaceEntry.mutate(
                          {
                            id: selected.id,
                            version: selected.version,
                            write: {
                              name: selected.name,
                              purpose: selected.purpose,
                              state: selected.state,
                              scope_type: selected.scope_type,
                              datasource_id: selected.datasource_id,
                              database_name: selected.database_name,
                              table_name: selected.table_name,
                              definition: { ...selected.definition, knowledge_text: draftText },
                              provenance: selected.provenance,
                            },
                          },
                          {
                            onSuccess: () => {
                              setKnowledgeTextDraft(null);
                            },
                          },
                        );
                      };
                      return (
                        <div className="flex flex-col gap-2">
                          <Textarea
                            value={draftText}
                            onChange={(event) => { setKnowledgeTextDraft(event.target.value); }}
                            onBlur={() => { if (dirty) save(); }}
                            rows={8}
                            data-testid="knowledge-notes-editor"
                            aria-label={t("admin.knowledge.editHeader")}
                          />
                          {dirty ? (
                            <Button
                              size="sm"
                              onClick={save}
                              disabled={replaceEntry.isPending}
                              data-testid="knowledge-notes-save"
                            >
                              {replaceEntry.isPending ? t("states.loading") : t("admin.knowledge.save")}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
          <Sheet open={notesSheetOpen} onOpenChange={setNotesSheetOpen}>
            <SheetContent side="left" className="w-80 gap-4 overflow-y-auto p-6" data-testid="knowledge-notes-sheet">
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={knowledgeSearch}
                  onChange={(event) => { setKnowledgeSearch(event.target.value); }}
                  placeholder={t("admin.knowledge.searchPlaceholder")}
                  className="pl-9"
                  aria-label={t("admin.knowledge.searchPlaceholder")}
                />
              </div>
              <h6 className="text-base">{t("admin.knowledge.allTitle")}</h6>
              <div className="flex flex-col gap-3">
                {filtered.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => { setSelectedKnowledgeId(entry.id); setNotesSheetOpen(false); }}
                    className={cn(
                      "cursor-pointer p-4 transition-colors",
                      selected?.id === entry.id
                        ? "bg-muted/70 ring-1 ring-primary/40"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <p className="truncate font-medium">{entry.name}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.updated_at.replace("T", " ").replace("Z", " UTC")}
                    </p>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </Card>

        {dialogOpen ? (
          <ReviewInputDialog
            key={editing?.id ?? "new"}
            kind="knowledge"
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
            kind="knowledge"
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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("admin.skills.title")}</CardTitle>
            <CardDescription>
              {t("admin.skills.description")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <TableSearchInput value={skillSearch} onChange={setSkillSearch} testId="admin-skills-search" />
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              data-testid="review-input-create"
            >
              <Plus /> {t("admin.skills.createTitle")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {evalErrorKey !== null ? (
            <Alert variant="destructive" data-testid="knowledge-eval-error">
              <AlertTitle>{t(evalErrorKey)}</AlertTitle>
            </Alert>
          ) : null}
          {loading ? (
            <LoadingState />
          ) : errored ? (
            <ErrorState error={toolsQuery.error} operationId="listPromptTools" onRetry={() => void refetch()} />
          ) : visibleSkillRows.length === 0 && skillSearch.trim() !== "" ? (
            <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-skills-search-empty">
              {t("table.emptySearch")}
            </p>
          ) : visibleSkillRows.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Puzzle />
                </EmptyMedia>
                <EmptyTitle>
                  {t("admin.skills.emptyTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {t("admin.skills.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.reviewInput.name")}</TableHead>
                  
                  <TableHead>{t("admin.reviewInput.state")}</TableHead>
                  
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={skillBodyRef} stale={toolsQuery.isFetching && toolsQuery.isPlaceholderData}>
                {visibleSkillRows.map((row) => {
                  const id = row.id;
                  const name = row.name;
                  const state = row.state;
                  
                  const builtin = (row as PromptTool).is_builtin;
                  const description = (row as PromptTool).description;
                  return (
                    <TableRow key={id} data-row-key={id} data-testid={`review-input-row-${id}`}>
                      <TableCell className="font-medium">
                        {/* §18.80：名称下方浅灰展示技能说明，用户不用进
                            编辑弹窗即可知道每个技能的用途；说明中的
                            {{参数}}占位按行内当前值动态渲染（补记1）。 */}
                        <span className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1.5">
                            {name}
                            {builtin ? (
                              <Badge variant="outline" data-testid={`review-input-builtin-${id}`}>
                                <Lock /> {t("admin.skills.builtinBadge")}
                              </Badge>
                            ) : null}
                          </span>
                          {description ? (
                            <span
                              className="text-muted-foreground text-xs font-normal"
                              data-testid={`review-input-description-${id}`}
                            >
                              {renderSkillDescription(description, (row as PromptTool).parameters ?? {})}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={state} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">

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
          {toolsLoaded ? (
            <TablePagination
              busy={toolsQuery.isFetching && toolsQuery.isPlaceholderData}
              page={skillPager.pageNo}
              hasMore={toolsQuery.data.page.has_more}
              isFirst={skillPager.isFirst}
              onPrev={skillPager.goPrev}
              onNext={() => { skillPager.pushCursor(toolsQuery.data.page.next_cursor); }}
              pageSize={skillPager.pageSize}
              onPageSizeChange={skillPager.setPageSize}
              testIdPrefix="skills"
            />
          ) : null}
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
  // §18.81：行内参数（键顺序稳定展示；内置与用户行同规则——值可调）。
  const rowParams: PromptToolWriteParameters =
    isSkills && editing !== null ? ((editing as PromptTool).parameters ?? {}) : {};
  const [paramInvalid, setParamInvalid] = useState(false);
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
      // §18.81：参数值按行内类型还原后再提交；非法值就地拦截不发请求。
      const params = convertParamDrafts(form.paramDrafts, rowParams);
      if (params === null) {
        setParamInvalid(true);
        return;
      }
      setParamInvalid(false);
      const write: PromptToolWrite = {
        name: form.name,
        // §18.80：全量替换语义——空串即清空；内置行由后端忽略载荷说明。
        description: form.description,
        state: form.state,
        engine: form.engine,
        parameters: params,
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
          {/* owner裁定：hash与失效影响说明属于编辑语境——从列表页整体
              移入对话框；hash仅编辑态可见（创建时尚未生成）。 */}
          <Alert className="border-[var(--risk-warning)]/40" data-testid="review-input-outdated-note">
            <AlertTitle>{t("admin.reviewInput.outdatedNoteTitle")}</AlertTitle>
            <AlertDescription>{t("admin.reviewInput.outdatedNoteBody")}</AlertDescription>
          </Alert>
          {editing !== null && editing.config_hash !== "" ? (
            <div className="flex flex-col gap-1">
              <Label>{t("admin.reviewInput.configHash")}</Label>
              <p className="break-all font-mono text-xs" data-testid="review-input-hash">
                {editing.config_hash}
              </p>
            </div>
          ) : null}
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
            {isSkills ? (
              <>
                {/* §18.80：名称整行 → 技能说明整行 → 状态/使用引擎水平
                    分布成一个段落。 */}
                <div className="flex flex-col gap-1 md:col-span-2">
                  <Label htmlFor="review-input-name">{t("admin.reviewInput.name")}</Label>
                  <Input
                    id="review-input-name"
                    value={form.name}
                    onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
                    disabled={editingBuiltin}
                    data-testid="review-input-name"
                  />
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <Label htmlFor="review-input-description">{t("admin.skills.descriptionLabel")}</Label>
                  <Input
                    id="review-input-description"
                    value={form.description}
                    maxLength={MAX_SKILL_DESCRIPTION}
                    onChange={(event) => { setForm({ ...form, description: event.target.value }); }}
                    placeholder={t("admin.skills.descriptionPlaceholder")}
                    disabled={editingBuiltin}
                    data-testid="review-input-description"
                  />
                  <p className="text-muted-foreground text-xs" data-testid="review-input-description-count">
                    {t("admin.skills.descriptionCount", { current: Array.from(form.description).length, max: MAX_SKILL_DESCRIPTION })}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor="review-input-name">{t("admin.reviewInput.name")}</Label>
                <Input
                  id="review-input-name"
                  value={form.name}
                  onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
                  data-testid="review-input-name"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label>{t("admin.reviewInput.state")}</Label>
              <Select
                value={form.state}
                onValueChange={(next) => {
                  if (next === null) return;
                  setForm({ ...form, state: next });
                }}
                items={Object.fromEntries(
                  STATE_ORDER.map((state) => [state, t(`admin.reviewInput.state_${state}`)]),
                )}
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
                    items={{
                      global: t("admin.knowledge.scopeGlobal"),
                      datasource: t("admin.knowledge.scopeDatasource"),
                      table: t("admin.knowledge.scopeTable"),
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
                          {(datasourcesQuery.data?.items ?? []).map((datasource: { id: string; name: string }) => (
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
          {isSkills && Object.keys(rowParams).length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="review-input-params">
              <div className="flex flex-col gap-0.5">
                <Label>{t("admin.skills.parametersTitle")}</Label>
                <p className="text-muted-foreground text-xs">{t("admin.skills.parametersHint")}</p>
              </div>
              {Object.entries(rowParams).map(([key, sample]) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`review-input-param-${key}`} className="font-mono text-xs">
                    {key} · {t(`admin.skills.${paramTypeKey(sample)}`)}
                  </Label>
                  {typeof sample === "boolean" ? (
                    <Checkbox
                      id={`review-input-param-${key}`}
                      checked={form.paramDrafts[key] === "true"}
                      onCheckedChange={(checked) => {
                        setParamInvalid(false);
                        setForm({ ...form, paramDrafts: { ...form.paramDrafts, [key]: checked ? "true" : "false" } });
                      }}
                      data-testid={`review-input-param-${key}`}
                    />
                  ) : (
                    <Input
                      id={`review-input-param-${key}`}
                      value={form.paramDrafts[key] ?? ""}
                      type={typeof sample === "number" ? "number" : "text"}
                      min={typeof sample === "number" ? 1 : undefined}
                      step={typeof sample === "number" ? 1 : undefined}
                      onChange={(event) => {
                        setParamInvalid(false);
                        setForm({ ...form, paramDrafts: { ...form.paramDrafts, [key]: event.target.value } });
                      }}
                      data-testid={`review-input-param-${key}`}
                    />
                  )}
                </div>
              ))}
              {paramInvalid ? (
                <p className="text-destructive text-xs" data-testid="review-input-param-error">
                  {t("admin.skills.parametersInvalid")}
                </p>
              ) : null}
            </div>
          ) : null}
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
    <AlertDialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.reviewInput.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.reviewInput.deleteDescription", { name: target.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="review-input-delete-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>{t("admin.reviewInput.deleteErrorHint")}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
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
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
