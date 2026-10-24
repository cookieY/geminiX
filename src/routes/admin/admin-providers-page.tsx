import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Pencil, PlugZap, Plus, Trash2 } from "lucide-react";
import type {
  AiProvider,
  AiProviderWrite,
  CreateAiProviderRequest,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { listAiProviderModels } from "@/api/generated/client/administration/administration";
import {
  useAiProviders,
  useCreateAiProvider,
  useDeleteAiProvider,
  useReplaceAiProvider,
  useTestAiProviderConnection,
} from "@/features/admin/use-admin";
import { useSession } from "@/features/auth/session-provider";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { TableSearchInput } from "@/shared/components/table-search-input";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
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
import { DropdownMenuItem } from "@/shared/components/ui/dropdown-menu";
import { TableRowActions } from "@/shared/components/table-row-actions";

/**
 * Provider 管理 (route /admin/review-engine/providers; UI spec §5.3 puts
 * provider administration in the review-engine group). The list renders the
 * primary/backup order exactly as the runtime consumes it —
 * selection_priority ascending (backend provider/chain.go:3), index 0 is
 * the primary. The API key is write-only: create requires it once, replace
 * keeps the stored key unless a new one is typed, and every read face
 * exposes only api_key_configured. The privacy/output contract hashes are
 * NOT form fields: the platform derives both from code constants
 * (provider contract_hash.go) and pins them per row at write time —
 * identical fingerprints across providers are what authorizes fallback
 * (chain.go gate) (R008/R005 boundary: no per-order budget here — that
 * is the ai-budget settings namespace).
 */

interface ProviderFormState {
  name: string;
  providerKind: string;
  baseUrl: string;
  modelName: string;
  enabled: boolean;
  selectionPriority: string;
  apiKey: string;
}

function emptyProviderForm(): ProviderFormState {
  return {
    name: "",
    providerKind: "openai_compatible",
    baseUrl: "",
    modelName: "",
    enabled: true,
    selectionPriority: "10",
    apiKey: "",
  };
}

function providerFormForEdit(provider: AiProvider): ProviderFormState {
  return {
    name: provider.name,
    providerKind: provider.provider_kind,
    baseUrl: provider.base_url,
    modelName: provider.model_name,
    enabled: provider.enabled,
    selectionPriority: String(provider.selection_priority),
    // Never prefilled: an empty key field on edit means "keep the stored
    // key" (gate: Secret永不回填).
    apiKey: "",
  };
}

function ProviderFormDialog({
  editing,
  onClose,
}: {
  editing: AiProvider | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Keyed per open by the parent: state initializes from the edited row.
  const [form, setForm] = useState<ProviderFormState>(() =>
    editing === null ? emptyProviderForm() : providerFormForEdit(editing),
  );
  const createMutation = useCreateAiProvider();
  const replaceMutation = useReplaceAiProvider();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // §18.76-B：模型目录联想。base_url+api_key齐备（或编辑态复用存储
  // 密钥）即自动拉取；400ms去抖+序号防陈旧回写。目录仅是联想建议，
  // 输入框始终保留手填；拉取失败静默降级为手填（保存时探针仍会
  // 给出真因）。结果按键缓存，loading由"键不匹配"派生——effect内
  // 不做同步setState（react-hooks/set-state-in-effect）。
  const catalogKey = `${form.baseUrl.trim()}\u0000${form.apiKey.trim()}\u0000${editing?.id ?? ""}`;
  const canFetchCatalog = form.baseUrl.trim() !== "" && (form.apiKey.trim() !== "" || editing !== null);
  const [catalog, setCatalog] = useState<{
    key: string;
    state: "done" | "failed";
    items: string[];
  } | null>(null);
  const catalogSeq = useRef(0);
  const [suggestOpen, setSuggestOpen] = useState(false);
  useEffect(() => {
    if (!canFetchCatalog) return;
    const seq = ++catalogSeq.current;
    const timer = setTimeout(() => {
      listAiProviderModels({
        base_url: form.baseUrl.trim(),
        ...(form.apiKey.trim() !== "" ? { api_key: form.apiKey.trim() } : {}),
        ...(form.apiKey.trim() === "" && editing !== null ? { provider_id: editing.id } : {}),
      })
        .then((res) => {
          if (catalogSeq.current !== seq) return;
          setCatalog({ key: catalogKey, state: "done", items: (res as unknown as { items: string[] }).items });
        })
        .catch(() => {
          if (catalogSeq.current !== seq) return;
          setCatalog({ key: catalogKey, state: "failed", items: [] });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      catalogSeq.current += 1;
    };
  }, [catalogKey, canFetchCatalog, editing, form.baseUrl, form.apiKey]);
  const catalogResult = catalog !== null && catalog.key === catalogKey ? catalog : null;
  const catalogView = !canFetchCatalog
    ? "idle"
    : catalogResult === null
      ? "loading"
      : catalogResult.state;
  // tsc不跨JSX子句收窄，先物化条目数组。
  const catalogItems = catalogView === "done" ? catalogResult?.items ?? [] : [];

  const mutation = editing === null ? createMutation : replaceMutation;

  const submit = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    setErrorDetail(null);
    const apiKey =
      form.apiKey === ""
        ? undefined
        : ({ value: form.apiKey });
    if (editing === null) {
      if (apiKey === undefined) {
        setErrorKey("errors.VALIDATION_FAILED");
        return;
      }
      const write = {
        name: form.name,
        provider_kind: form.providerKind,
        base_url: form.baseUrl,
        model_name: form.modelName,
        enabled: form.enabled,
        selection_priority: Number(form.selectionPriority),
        api_key: apiKey,
      } as CreateAiProviderRequest;
      createMutation.mutate(write, {
        onSuccess: onClose,
        onError: (error) => {
          const display = describeError(error, "createAiProvider");
          setErrorKey(display.messageKey);
          setErrorRequestId(display.requestId);
          setErrorDetail(display.detail);
        },
      });
    } else {
      const write: AiProviderWrite = {
        name: form.name,
        provider_kind: form.providerKind,
        base_url: form.baseUrl,
        model_name: form.modelName,
        enabled: form.enabled,
        selection_priority: Number(form.selectionPriority),
        ...(apiKey === undefined ? {} : { api_key: apiKey }),
      };
      replaceMutation.mutate(
        { id: editing.id, version: editing.version, write },
        {
          onSuccess: onClose,
          onError: (error) => {
            const display = describeError(error, "replaceAiProvider");
            setErrorKey(display.messageKey);
            setErrorRequestId(display.requestId);
            setErrorDetail(display.detail);
          },
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? t("admin.providers.createTitle") : t("admin.providers.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.providers.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-name">{t("admin.providers.name")}</Label>
            <Input
              id="provider-name"
              value={form.name}
              onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
              data-testid="provider-name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("admin.providers.kind")}</Label>
            {/* §18.68：类型改为受控下拉——运行时Dial只有OpenAI Compatible
                一种适配器（provider_kind零分支透传），选项集如实反映能力，
                未来新增协议时在此追加。items做显示映射，SelectItem显式子项
                （§18.48终稿模式；空SelectContent=弹层零选项）。 */}
            <Select
              value={form.providerKind}
              onValueChange={(next) => {
                if (next !== null) setForm({ ...form, providerKind: next });
              }}
              items={{ openai_compatible: t("admin.providers.kindOpenaiCompatible") }}
            >
              <SelectTrigger data-testid="provider-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai_compatible">
                  {t("admin.providers.kindOpenaiCompatible")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="provider-base-url">{t("admin.providers.baseUrl")}</Label>
            <Input
              id="provider-base-url"
              value={form.baseUrl}
              onChange={(event) => { setForm({ ...form, baseUrl: event.target.value }); }}
              placeholder="https://api.example.com/v1"
              data-testid="provider-base-url"
            />
          </div>
          {/* §18.76-B：API Key移到模型上方——目录联想依赖两者齐备，
              视觉顺序即填写顺序。 */}
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="provider-api-key">{t("admin.providers.apiKey")}</Label>
            <Input
              id="provider-api-key"
              type="password"
              value={form.apiKey}
              onChange={(event) => { setForm({ ...form, apiKey: event.target.value }); }}
              autoComplete="new-password"
              placeholder={
                editing !== null && editing.api_key_configured
                  ? t("admin.providers.apiKeyKeepPlaceholder")
                  : ""
              }
              data-testid="provider-api-key"
            />
            {editing !== null ? (
              <p className="text-muted-foreground text-xs">
                {t("admin.providers.apiKeyConfigured", {
                  state: editing.api_key_configured
                    ? t("admin.providers.configured")
                    : t("admin.providers.notConfigured"),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-model">{t("admin.providers.model")}</Label>
            {/* §18.76-B真机修正：relative只包输入框（面板top-full正挂输入框
                下方，不随提示行漂移）；开合跟input focus/blur，选项用
                onMouseDown选取（preventDefault防blur先吞点击），选中即收起。 */}
            <div className="relative">
              <Input
                id="provider-model"
                value={form.modelName}
                onChange={(event) => { setForm({ ...form, modelName: event.target.value }); }}
                onFocus={() => { setSuggestOpen(true); }}
                onBlur={() => { setSuggestOpen(false); }}
                data-testid="provider-model"
              />
              {suggestOpen && catalogItems.length > 0 ? (
                <div
                  className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover"
                  data-testid="provider-model-options"
                >
                  {catalogItems.map((model) => (
                    <button
                      key={model}
                      type="button"
                      className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setForm((prev) => ({ ...prev, modelName: model }));
                        setSuggestOpen(false);
                      }}
                      data-testid={`provider-model-option-${model}`}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">{t("admin.providers.modelCatalogHint")}</p>
            {catalogView === "loading" ? (
              <p className="text-muted-foreground text-xs" data-testid="provider-model-catalog-loading">
                {t("admin.providers.modelCatalogLoading")}
              </p>
            ) : null}
            {catalogView === "failed" ? (
              <p className="text-muted-foreground text-xs" data-testid="provider-model-catalog-failed">
                {t("admin.providers.modelCatalogFailed")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-priority">{t("admin.providers.priority")}</Label>
            <Input
              id="provider-priority"
              type="number"
              min={1}
              max={100}
              value={form.selectionPriority}
              onChange={(event) => { setForm({ ...form, selectionPriority: event.target.value }); }}
              data-testid="provider-priority"
            />
            <p className="text-muted-foreground text-xs">{t("admin.providers.priorityHint")}</p>
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              id="provider-enabled"
              checked={form.enabled}
              onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); }}
              className="size-4"
              data-testid="provider-enabled"
            />
            <Label htmlFor="provider-enabled" className="cursor-pointer">
              {t("admin.providers.enabled")}
            </Label>
          </div>
        </div>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="provider-form-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>
              {/* §18.75-A：上游拒因快照逐字显示（meta.detail，服务端限长
                  300字符），操作者一眼分清"URL错/key无效/模型不支持"——
                  不再只给笼统的不可用提示。 */}
              {errorDetail !== null ? (
                <p className="mb-2 break-all font-mono" data-testid="provider-form-error-detail">
                  {errorDetail}
                </p>
              ) : null}
              {errorRequestId !== null ? `request_id: ${errorRequestId}` : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending} data-testid="provider-submit">
            {mutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({
  provider,
  ordinal,
  onEdit,
  onAskDelete,
}: {
  provider: AiProvider;
  ordinal: number;
  onEdit: () => void;
  onAskDelete: () => void;
}) {
  const { t } = useTranslation();
  const testMutation = useTestAiProviderConnection();
  // RCP-20261017 第019项：连接测试是同步{ok}结果——pending/成功/失败三态
  // 直接渲染；失败带request_id与上游拒因（§18.75-A同通道），不再有
  // 任何Task轮询路径（旧Task形状会让成功静默、失败无细节）。
  const [testOk, setTestOk] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  return (
    <TableRow data-testid={`provider-row-${provider.id}`} data-row-key={provider.id}>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Badge variant={ordinal === 0 ? "default" : "outline"} data-testid={`provider-role-${provider.id}`}>
            {ordinal === 0 ? t("admin.providers.primary") : t("admin.providers.backup")}
          </Badge>
          <span className="font-medium">{provider.name}</span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{provider.provider_kind}</TableCell>
      <TableCell className="max-w-48 truncate font-mono text-xs">{provider.base_url}</TableCell>
      <TableCell className="font-mono text-xs">{provider.model_name}</TableCell>
      <TableCell className="font-mono text-xs">{provider.selection_priority}</TableCell>
      <TableCell>
        <Badge
          variant={provider.enabled ? "default" : "outline"}
          data-testid={`provider-enabled-${provider.id}`}
        >
          {provider.enabled ? t("admin.providers.enabled") : t("admin.providers.disabled")}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant={provider.api_key_configured ? "secondary" : "destructive"}
          data-testid={`provider-apikey-${provider.id}`}
        >
          <KeyRound className="mr-1 size-3" />
          {provider.api_key_configured
            ? t("admin.providers.configured")
            : t("admin.providers.notConfigured")}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-1">
          <TableRowActions testId={`provider-actions-${provider.id}`}>
            <DropdownMenuItem
              disabled={testMutation.isPending}
              onClick={() => {
                setTestOk(false);
                setErrorKey(null);
                setErrorDetail(null);
                setErrorRequestId(null);
                testMutation.mutate(
                  { id: provider.id },
                  {
                    onSuccess: () => { setTestOk(true); },
                    onError: (error) => {
                      const display = describeError(error, "testAiProviderConnection");
                      setErrorKey(display.messageKey);
                      setErrorDetail(display.detail);
                      setErrorRequestId(display.requestId);
                    },
                  },
                );
              }}
              data-testid={`provider-test-${provider.id}`}
            >
              <PlugZap /> {t("admin.datasources.testConnection")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit} data-testid={`provider-edit-${provider.id}`}>
              <Pencil /> {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onAskDelete} data-testid={`provider-delete-${provider.id}`}>
              <Trash2 /> {t("common.delete")}
            </DropdownMenuItem>
          </TableRowActions>
          {testMutation.isPending ? (
            <p className="text-muted-foreground text-xs" data-testid={`provider-test-running-${provider.id}`}>
              {t("admin.datasources.testRunning")}
            </p>
          ) : null}
          {testOk && !testMutation.isPending ? (
            <p className="text-xs text-[var(--risk-safe)]" data-testid={`provider-test-ok-${provider.id}`}>
              {t("admin.providers.testOk")}
            </p>
          ) : null}
          {errorKey !== null ? (
            <div className="text-right">
              <p className="text-xs text-destructive">{t(errorKey)}</p>
              {errorDetail !== null ? (
                <p className="break-all font-mono text-xs text-destructive" data-testid={`provider-test-error-detail-${provider.id}`}>
                  {errorDetail}
                </p>
              ) : null}
              {errorRequestId !== null ? (
                <p className="text-muted-foreground text-xs">request_id: {errorRequestId}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ProviderDeleteDialog({
  provider,
  onClose,
}: {
  provider: AiProvider;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteAiProvider();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.providers.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("admin.providers.deleteDescription", { name: provider.name })}</DialogDescription>
        </DialogHeader>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="provider-delete-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>{errorKey === "errors.generic.business" ? t("admin.providers.deleteErrorHint") : null}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate(
                { id: provider.id, version: provider.version },
                {
                  onSuccess: onClose,
                  onError: (error) => {
                    const display = describeError(error, "deleteAiProvider");
                    setErrorKey(display.messageKey);
                  },
                },
              );
            }}
            data-testid="provider-delete-confirm"
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminProvidersPage() {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const [search, setSearch] = useState("");
  // §18.82：后端游标分页（默认20行/页）；搜索变更回到第一页。
  const pager = useCursorPage(20);
  const query = useAiProviders(enabled, search.trim() || undefined, {
    limit: pager.pageSize,
    after: pager.after,
  });
  // §18.82：先于穷尽三元捕获，避免收窄泄漏进分页守卫。
  const providersLoaded = !query.isPending && !query.isError;
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // §18.73：搜索走服务端q（名称/BaseURL/模型名子串）；keyword仅用于
  // 空态文案区分。
  const keyword = search.trim();
  const providers = query.data?.items ?? [];
  // §18.73：搜索在服务端收窄，行集合变化时用 FLIP 把整行位移补间掉。
  const providersBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(providers.map((provider) => provider.id)),
  );
  const [deleting, setDeleting] = useState<AiProvider | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("admin.providers.title")}</CardTitle>
            <CardDescription>{t("admin.providers.description")}</CardDescription>
          </div>
          <TableSearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              pager.reset();
            }}
            testId="admin-providers-search"
          />
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="provider-create"
          >
            <Plus /> {t("admin.providers.createTitle")}
          </Button>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} operationId="listAiProviders" onRetry={() => void query.refetch()} />
          ) : providers.length === 0 && keyword !== "" ? (
            <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-providers-search-empty">
              {t("table.emptySearch")}
            </p>
          ) : providers.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>{t("admin.providers.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("admin.providers.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.providers.name")}</TableHead>
                  <TableHead>{t("admin.providers.kind")}</TableHead>
                  <TableHead>{t("admin.providers.baseUrl")}</TableHead>
                  <TableHead>{t("admin.providers.model")}</TableHead>
                  <TableHead>{t("admin.providers.priority")}</TableHead>
                  <TableHead>{t("admin.providers.enabled")}</TableHead>
                  <TableHead>{t("admin.providers.apiKey")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={providersBodyRef} stale={query.isFetching && query.isPlaceholderData}>
                {providers.map((provider, index) => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    ordinal={index}
                    onEdit={() => {
                      setEditing(provider);
                      setDialogOpen(true);
                    }}
                    onAskDelete={() => { setDeleting(provider); }}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {providersLoaded ? (
            <TablePagination
              busy={query.isFetching && query.isPlaceholderData}
              page={pager.pageNo}
              hasMore={query.data.page.has_more}
              isFirst={pager.isFirst}
              onPrev={pager.goPrev}
              onNext={() => { pager.pushCursor(query.data.page.next_cursor); }}
              pageSize={pager.pageSize}
              onPageSizeChange={pager.setPageSize}
              testIdPrefix="providers"
            />
          ) : null}
        </CardContent>
      </Card>
      {deleting !== null ? (
        <ProviderDeleteDialog
          key={deleting.id}
          provider={deleting}
          onClose={() => { setDeleting(null); }}
        />
      ) : null}
      {dialogOpen ? (
        <ProviderFormDialog
          key={editing?.id ?? "new"}
          editing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
