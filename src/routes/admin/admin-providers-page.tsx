import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Cpu, KeyRound, ListOrdered, Pencil, PlugZap, Plus, ShieldAlert, Trash2, Undo2 } from "lucide-react";
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
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { StatusBadge } from "@/shared/components/status/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { TableSearchInput } from "@/shared/components/table-search-input";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Input } from "@/shared/components/ui/input";
import { NumberInput } from "@/shared/components/ui/number-input";
import { PasswordInput } from "@/shared/components/ui/password-input";
import { Tabs, TabsContent, TabsList, TabsStack, TabsTrigger } from "@/shared/components/ui/tabs";
import { ProviderPricingPanel, ProviderUsagePanel } from "@/features/admin/provider-pricing";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Label } from "@/shared/components/ui/label";
import { DropdownMenuItem } from "@/shared/components/ui/dropdown-menu";
import { TableRowActions } from "@/shared/components/table-row-actions";
import { PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";

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
  // S008生成参数：字符串态承载三态——""=服务商默认（不发送）、temperature
  // "0"是显式零（Number转换后0仍发送，绝不按默认折叠）。
  reasoningEffort: "" | "low" | "medium" | "high";
  maxTokens: string;
  temperature: string;
  /** 初始参数快照：per-field撤销（撤销修改）恢复到这里；与“服务商默认”
      （清空值）语义分离（deliverable：撤销修改与使用服务商默认分离）。 */
  initialParams: { reasoningEffort: "" | "low" | "medium" | "high"; maxTokens: string; temperature: string };
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
    reasoningEffort: "",
    maxTokens: "",
    temperature: "",
    initialParams: { reasoningEffort: "", maxTokens: "", temperature: "" },
  };
}

/**
 * S008参数写入语义（M2）：三项全部保持初始值 → 整个configuration键省略
 * （保留已存配置）；任一项被改动 → 提供显式对象整体替换，对象内留空的键
 * =清除该用户覆盖（即“使用服务商默认”）。temperature的"0"经trim保留为
 * 显式0（Number("0")=0，从不被当默认折叠）。
 */
function configurationWrite(form: ProviderFormState): AiProviderWrite["configuration"] {
  const initial = form.initialParams;
  const touched =
    form.reasoningEffort !== initial.reasoningEffort ||
    form.maxTokens !== initial.maxTokens ||
    form.temperature !== initial.temperature;
  if (!touched) return undefined;
  const configuration: NonNullable<AiProviderWrite["configuration"]> = {};
  if (form.reasoningEffort !== "") configuration.reasoning_effort = form.reasoningEffort;
  if (form.maxTokens !== "") {
    const parsed = Number(form.maxTokens);
    if (Number.isFinite(parsed) && form.maxTokens.trim() !== "") configuration.max_tokens = parsed;
  }
  if (form.temperature !== "") {
    const parsed = Number(form.temperature);
    if (Number.isFinite(parsed) && form.temperature.trim() !== "") configuration.temperature = parsed;
  }
  return configuration;
}

/**
 * S008参数字段校验（PRD §6「保存错误定位到字段」；后端
 * ValidateProviderConfiguration只回笼统1001不带字段名，字段定位镜像合同
 * 由客户端完成）：留空=服务商默认不校验；max_tokens须为整数256..200000；
 * temperature须为数值0..2（"0"是显式零，合法）。返回i18n message key。
 */
function paramFieldErrors(form: ProviderFormState): { maxTokens: string | null; temperature: string | null } {
  const parsedMax = form.maxTokens.trim() === "" ? null : Number(form.maxTokens);
  const parsedTemp = form.temperature.trim() === "" ? null : Number(form.temperature);
  return {
    maxTokens:
      parsedMax === null || (Number.isInteger(parsedMax) && parsedMax >= 256 && parsedMax <= 200000)
        ? null
        : "admin.providers.gen.maxTokensInvalid",
    temperature:
      parsedTemp === null || (Number.isFinite(parsedTemp) && parsedTemp >= 0 && parsedTemp <= 2)
        ? null
        : "admin.providers.gen.temperatureInvalid",
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
    // S008参数完整回填：已存值优先，未配置=服务商默认（空串）。
    reasoningEffort: provider.configuration?.reasoning_effort ?? "",
    maxTokens: provider.configuration?.max_tokens != null ? String(provider.configuration.max_tokens) : "",
    temperature: provider.configuration?.temperature != null ? String(provider.configuration.temperature) : "",
    initialParams: {
      reasoningEffort: provider.configuration?.reasoning_effort ?? "",
      maxTokens: provider.configuration?.max_tokens != null ? String(provider.configuration.max_tokens) : "",
      temperature: provider.configuration?.temperature != null ? String(provider.configuration.temperature) : "",
    },
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
  // S008参数逐字段错误（提交前校验失败时定位到字段，不发请求）。
  const [paramErrors, setParamErrors] = useState<{ maxTokens: string | null; temperature: string | null }>({
    maxTokens: null,
    temperature: null,
  });

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
    // 参数字段校验先于mutation：无效值就地定位，不发请求、不触发探针。
    // paramErrors存已解析文本（RCP-20261102-S008后服务端1001也带字段
    // 定位meta.fields，英文约束句与本地化文案同槽直存直显）。
    const params = paramFieldErrors(form);
    if (params.maxTokens !== null || params.temperature !== null) {
      setParamErrors({
        maxTokens: params.maxTokens !== null ? t(params.maxTokens) : null,
        temperature: params.temperature !== null ? t(params.temperature) : null,
      });
      return;
    }
    setParamErrors({ maxTokens: null, temperature: null });
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
        configuration: configurationWrite(form),
      } as CreateAiProviderRequest;
      createMutation.mutate(write, {
        onSuccess: onClose,
        onError: (error) => {
          const display = describeError(error, "createAiProvider");
          setErrorKey(display.messageKey);
          setErrorRequestId(display.requestId);
          setErrorDetail(display.detail);
          setParamErrors({
            maxTokens: display.fields.max_tokens?.[0] ?? null,
            temperature: display.fields.temperature?.[0] ?? null,
          });
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
        configuration: configurationWrite(form),
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
            setParamErrors({
              maxTokens: display.fields.max_tokens?.[0] ?? null,
              temperature: display.fields.temperature?.[0] ?? null,
            });
          },
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? t("admin.providers.createTitle") : t("admin.providers.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.providers.formDescription")}</DialogDescription>
        </DialogHeader>
        {/* S008三分组（owner 2026-10-31开工FE包）：连接配置/生成参数/参考计价
            （费率+费用统计同组，PRD界面-01/02）。创建态无provider id，
            计价/费用组以提示占位。 */}
        <Tabs defaultValue="connection">
          <TabsList className="-my-1 max-w-full overflow-x-auto overflow-y-hidden py-1">
            <TabsTrigger value="connection" data-testid="provider-tab-connection">
              {t("admin.providers.tabs.connection")}
            </TabsTrigger>
            <TabsTrigger value="generation" data-testid="provider-tab-generation">
              {t("admin.providers.tabs.generation")}
            </TabsTrigger>
            <TabsTrigger value="pricing" data-testid="provider-tab-pricing">
              {t("admin.providers.tabs.pricing")}
            </TabsTrigger>
          </TabsList>

          <TabsStack>
          <TabsContent value="connection" stacked>
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
            <PasswordInput
              id="provider-api-key"
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
                /* 滚动条统一（owner 2026-11-03）：模型建议下拉用ScrollArea覆盖式thumb。 */
                <ScrollArea
                  className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover"
                  viewportClassName="max-h-48"
                  data-testid="provider-model-options"
                >
                  <div>
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
                </ScrollArea>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">{t("admin.providers.modelCatalogHint")}</p>
            {/* 状态行预留固定一行高度：失败提示出现或消失不改变布局（加载中不再显示提示语，owner 2026-11-03），
                打开弹窗不再因这一行的进出而抖动（owner 2026-11-03）。 */}
            <div className="min-h-4">
              {catalogView === "failed" ? (
                <p className="text-muted-foreground text-xs" data-testid="provider-model-catalog-failed">
                  {t("admin.providers.modelCatalogFailed")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-priority">{t("admin.providers.priority")}</Label>
            <NumberInput
              id="provider-priority"
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
          </TabsContent>

          <TabsContent value="generation" stacked>
          <div className="flex flex-col gap-4" data-testid="provider-generation-panel">
            <p className="text-muted-foreground text-xs">{t("admin.providers.gen.hint")}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="provider-gen-reasoning">{t("admin.providers.gen.reasoningEffort")}</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={form.reasoningEffort === "" ? "default" : form.reasoningEffort}
                  onValueChange={(next) => {
                    if (next === null) return;
                    const value = next === "default" ? "" : (next as "low" | "medium" | "high");
                    setForm({ ...form, reasoningEffort: value });
                  }}
                >
                  <SelectTrigger id="provider-gen-reasoning" data-testid="provider-gen-reasoning" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{t("admin.providers.gen.reasoningEffortDefault")}</SelectItem>
                    <SelectItem value="low">low</SelectItem>
                    <SelectItem value="medium">medium</SelectItem>
                    <SelectItem value="high">high</SelectItem>
                  </SelectContent>
                </Select>
                <ParamRevertButton
                  dirty={form.reasoningEffort !== form.initialParams.reasoningEffort}
                  initial={form.initialParams.reasoningEffort}
                  onRevert={(value) => { setForm({ ...form, reasoningEffort: value as ProviderFormState["reasoningEffort"] }); }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="provider-gen-max-tokens">{t("admin.providers.gen.maxTokens")}</Label>
              <div className="flex items-center gap-2">
                <NumberInput
                  id="provider-gen-max-tokens"
                  min={256}
                  max={200000}
                  value={form.maxTokens}
                  onChange={(event) => {
                    setParamErrors((current) => ({ ...current, maxTokens: null }));
                    setForm({ ...form, maxTokens: event.target.value });
                  }}
                  placeholder={t("admin.providers.gen.reasoningEffortDefault")}
                  aria-invalid={paramErrors.maxTokens !== null}
                  data-testid="provider-gen-max-tokens"
                  className="font-mono"
                  wrapperClassName="w-60 shrink-0"
                />
                <span className="text-muted-foreground text-xs">{t("admin.providers.gen.maxTokensRange")}</span>
                <ParamRevertButton
                  dirty={form.maxTokens !== form.initialParams.maxTokens}
                  initial={form.initialParams.maxTokens}
                  onRevert={(value) => { setForm({ ...form, maxTokens: value }); }}
                />
              </div>
              {paramErrors.maxTokens !== null && (
                <p className="text-destructive text-xs" data-testid="provider-gen-max-tokens-error">
                  {paramErrors.maxTokens}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="provider-gen-temperature">{t("admin.providers.gen.temperature")}</Label>
              <div className="flex items-center gap-2">
                <NumberInput
                  id="provider-gen-temperature"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(event) => {
                    setParamErrors((current) => ({ ...current, temperature: null }));
                    setForm({ ...form, temperature: event.target.value });
                  }}
                  placeholder={t("admin.providers.gen.reasoningEffortDefault")}
                  aria-invalid={paramErrors.temperature !== null}
                  data-testid="provider-gen-temperature"
                  className="font-mono"
                  wrapperClassName="w-60 shrink-0"
                />
                <span className="text-muted-foreground text-xs">{t("admin.providers.gen.temperatureRange")}</span>
                <ParamRevertButton
                  dirty={form.temperature !== form.initialParams.temperature}
                  initial={form.initialParams.temperature}
                  onRevert={(value) => { setForm({ ...form, temperature: value }); }}
                />
              </div>
              {paramErrors.temperature !== null && (
                <p className="text-destructive text-xs" data-testid="provider-gen-temperature-error">
                  {paramErrors.temperature}
                </p>
              )}
            </div>
          </div>
          </TabsContent>

          {/* 计价/用量面板内容长且表格宽：绝对定位脱离网格尺寸计算，高度由
              连接/生成参数两个面板决定，自身在固定高度内滚动，切换tab不再
              拉伸弹窗（owner 2026-11-03）。 */}
          <TabsContent value="pricing" stacked className="relative">
            {/* 滚动条统一（owner 2026-11-03）：定价/用量面板滚动用
                ScrollArea覆盖式thumb（原先为原生overflow-auto）。 */}
            {editing === null ? (
              <p className="text-muted-foreground text-sm" data-testid="provider-pricing-create-hint">
                {t("admin.providers.pricing.empty")}
              </p>
            ) : (
              <ScrollArea className="absolute inset-0">
                <div className="flex flex-col gap-5">
                  <ProviderPricingPanel providerId={editing.id} />
                  <ProviderUsagePanel providerId={editing.id} />
                </div>
              </ScrollArea>
            )}
          </TabsContent>
          </TabsStack>
        </Tabs>

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
          <PendingButton pending={mutation.isPending} onClick={submit} data-testid="provider-submit">
            {t("common.save")}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** per-field撤销（恢复初始快照）；与“服务商默认”（清空值）分离。 */
function ParamRevertButton({
  dirty,
  initial,
  onRevert,
}: {
  dirty: boolean;
  initial: string;
  onRevert: (initial: string) => void;
}) {
  const { t } = useTranslation();
  if (!dirty) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => { onRevert(initial); }}
      data-testid="provider-gen-revert"
      aria-label={t("admin.providers.gen.revert")}
      title={t("admin.providers.gen.revert")}
    >
      <Undo2 aria-hidden />
    </Button>
  );
}

function ProviderCard({
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
    <div
      data-testid={`provider-row-${provider.id}`}
      data-row-key={provider.id}
      className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            provider.enabled ? "bg-tone-emerald/10 text-tone-emerald" : "bg-muted text-muted-foreground",
          )}
        >
          <Cpu className="size-4" aria-hidden />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={provider.name}>{provider.name}</span>
        <div className="shrink-0">
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
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={ordinal === 0 ? "default" : "outline"} className="h-5 px-2" data-testid={`provider-role-${provider.id}`}>
          {ordinal === 0 ? t("admin.providers.primary") : t("admin.providers.backup")}
        </Badge>
        <StatusBadge
          tone={provider.enabled ? "emerald" : "stone"}
          data-testid={`provider-enabled-${provider.id}`}
        >
          {provider.enabled ? t("admin.providers.enabled") : t("admin.providers.disabled")}
        </StatusBadge>
        <StatusBadge
          tone={provider.api_key_configured ? "emerald" : "red"}
          data-testid={`provider-apikey-${provider.id}`}
        >
          <KeyRound className="mr-1 size-3" />
          {provider.api_key_configured
            ? t("admin.providers.configured")
            : t("admin.providers.notConfigured")}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 font-mono text-xs">
        <span className="truncate text-foreground/90" title={provider.model_name}>{provider.model_name}</span>
        <span className="truncate text-muted-foreground" title={provider.base_url}>{provider.base_url}</span>
        <span className="flex min-w-0 items-baseline justify-between gap-2 text-muted-foreground">
          <span className="truncate" title={provider.provider_kind}>{provider.provider_kind}</span>
          <span className="shrink-0 tabular-nums">{t("admin.providers.priority")} {provider.selection_priority}</span>
        </span>
      </div>
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
        <div>
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
          <PendingButton
            variant="destructive"
            pending={deleteMutation.isPending}
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
          </PendingButton>
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
  const providersBodyRef = useFlipReorder<HTMLDivElement>(
    JSON.stringify(providers.map((provider) => provider.id)),
  );
  const [deleting, setDeleting] = useState<AiProvider | null>(null);

  return (
    <PageLayout>
      <Card data-testid="admin-providers-panel" className="gap-0 py-0">
        <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground">
            <Bot className="size-5" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">{t("admin.providers.title")}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("admin.providers.description")}</p>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="provider-create"
          >
            <Plus /> {t("admin.providers.createTitle")}
          </Button>
        </header>
        <div className="grid grid-cols-1 gap-3 border-b border-border p-5 md:grid-cols-2">
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-[13px] text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t("admin.providers.notice.keyTitle")}</p>
              <p className="leading-relaxed">{t("admin.providers.notice.keyBody")}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border p-3.5 text-[13px] text-muted-foreground">
            <ListOrdered className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="leading-relaxed">{t("admin.providers.notice.orderBody")}</p>
          </div>
        </div>
        <section className="flex flex-col gap-4 p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 className="text-base font-semibold tracking-tight">{t("admin.providers.listTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("admin.providers.listDescription")}</p>
            </div>
            <TableSearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                pager.reset();
              }}
              testId="admin-providers-search"
            />
          </div>
          {query.isPending ? (
            <LoadingState variant="panel" />
          ) : query.isError ? (
            <ErrorState error={query.error} operationId="listAiProviders" onRetry={() => void query.refetch()} />
          ) : providers.length === 0 && keyword !== "" ? (
            <EmptyState
              title={t("table.emptySearch")}
              filtered
              testId="admin-providers-search-empty"
            />
          ) : providers.length === 0 ? (
            <EmptyState
              title={t("admin.providers.emptyTitle")}
              description={t("admin.providers.emptyDescription")}
            />
          ) : (
            <div
              ref={providersBodyRef}
              aria-busy={query.isFetching && query.isPlaceholderData}
              className={cn(
                "grid grid-cols-1 gap-3 transition-opacity duration-150 ease-out sm:grid-cols-2 lg:grid-cols-4",
                query.isFetching && query.isPlaceholderData && "opacity-60",
              )}
            >
              {providers.map((provider, index) => (
                <ProviderCard
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
            </div>
          )}
        </section>
        {providersLoaded ? (
          <TablePagination
            busy={query.isFetching && query.isPlaceholderData}
            page={pager.pageNo}
            hasMore={query.data.page.has_more}
            isFirst={pager.isFirst}
            onPrev={pager.goPrev}
            onJumpPage={pager.goToPage}
            onNext={() => { pager.pushCursor(query.data.page.next_cursor); }}
            pageSize={pager.pageSize}
            onPageSizeChange={pager.setPageSize}
            rowsOnPage={query.data.items.length}
            testIdPrefix="providers"
          />
        ) : null}
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
    </PageLayout>
  );
}
