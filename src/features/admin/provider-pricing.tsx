import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Wand2 } from "lucide-react";
import type {
  AiCallUsage,
  AiProviderRateVersion,
  CreateAiProviderRateVersionRequest,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useAiProviderRateVersions,
  useAiUsageCalls,
  useAiUsageSummaryToday,
  useCreateAiProviderRateVersion,
  useSettingsNamespace,
} from "@/features/admin/use-admin";
import { describeError } from "@/shared/api/error-display";
import i18next from "@/shared/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { useCursorPage } from "@/shared/lib/cursor-page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

/**
 * S008 参考计价面板（FE包 2026-10-31）：费率版本列表 + 新建版本表单 +
 * 费用统计/调用明细 + 常驻参考声明（界面-02：金额叫参考成本，不出现
 * “实际扣款”类误导）。参考模板 = 全局设置里的输入/输出参考价，应用是
 * 显式按钮动作（PRD：模板应用需显式动作，不自动覆盖已填值）。
 */

export const RATE_REFERENCE_DECLARATION_KEY = "admin.providers.pricing.declaration";

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

function minuteToHM(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parse a user-typed day-time into a minute-of-day, contract bound to
 * ≤1440 ("24:00" is the representable full-day end; <input type="time">
 * can never hold it). Accepts partial typing ("9", "9:", "9:3") as
 * progressive feedback and returns null for blank/garbled input so the
 * caller can keep the previous value instead of writing NaN.
 */
function parseDayMinute(text: string): number | null {
  if (text.trim() === "") return null;
  const match = /^(\d{1,2})(?::(\d{0,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const h = Number(match[1]);
  const m = match[2] === undefined || match[2] === "" ? 0 : Number(match[2]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return Math.min(h * 60 + m, 1440);
}

function effectiveText(version: AiProviderRateVersion): string {
  const until = version.effective_until ?? i18next.t("admin.providers.pricing.openEnded");
  return `${version.effective_from.slice(0, 10)} → ${until.slice(0, 10)}`;
}

type RateVersionStatus = "current" | "future" | "expired";

/** 时钟读取收在函数内（react-compiler纯度规则不追函数边界，仓库先例
 * evidence-sheet.remainingDays同型）：判定必须用真实当前时间。 */
function currentNowMs(): number {
  return Date.now();
}

/** PRD §6：当前有效与下个生效版本可读。开放版本（wire上effective_until
 * 缺省或null等价）以上限+∞参与比较；任一future版本中最早from者标记
 * 下一个生效， Past/future其余版本不带徽标（生效期文本已自说明）。 */
function versionStatus(version: AiProviderRateVersion, nowMs: number): RateVersionStatus {
  const from = Date.parse(version.effective_from);
  const until = version.effective_until == null
    ? Number.POSITIVE_INFINITY
    : Date.parse(version.effective_until);
  if (from <= nowMs && nowMs < until) return "current";
  return from > nowMs ? "future" : "expired";
}

const EMPTY_WINDOW = {
  start_minute: 0,
  end_minute: 1440,
  input_price: "",
  output_price: "",
  cached_read_price: "",
  cached_write_price: "",
};

/** 合同价格口径（OpenAPI AiProviderRateWindow）：非负定点十进制，≤12位
 * 整数+可选≤6位小数（"0"、"6"、"2.34"均合法）；cached_*可缺省（空串=
 * 未配置），input/output必填。 */
const PRICE_PATTERN = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;

function emptyRateDraft() {
  return {
    currency: "CNY",
    timezone: "Asia/Shanghai",
    effective_from: "",
    effective_until: "",
    windows: [{ ...EMPTY_WINDOW }],
  };
}

type RateDraft = ReturnType<typeof emptyRateDraft>;

/** 价格输入：可访问名称（aria-label，占位符不作为标签）+ 逐字段错误
 * 定位（PRD §6）。 */
function PriceInput({ testId, label, value, onChange, error }: {
  testId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => { onChange(event.target.value); }}
        aria-invalid={error !== null}
        data-testid={testId}
        className="font-mono text-xs"
      />
      {error !== null && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

export function ProviderPricingPanel({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const versionsQuery = useAiProviderRateVersions(providerId, true);
  // 参考模板来源：全局设置的输入/输出参考价（显式按钮动作才填入）。
  const budgetSettingsQuery = useSettingsNamespace("ai-budget", true);
  const versions = versionsQuery.data ?? [];
  const createMutation = useCreateAiProviderRateVersion();
  const [draft, setDraft] = useState<RateDraft>(emptyRateDraft);
  const [showForm, setShowForm] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // PRD §6「保存错误定位到字段」：后端VALIDATION_FAILED不带字段名，
  // 字段定位由提交前的客户端校验完成（合同口径镜像）。
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // 模板跨币种冲突说明（显式动作被拒时必须解释原因，不得静默不动）。
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  // 日期感知徽标：当前生效按真实时间判定；未来版本里最早from者=下一个
  // 生效（列表顺序不保证from升序，不能按位置取第一个future）。
  const nowMs = currentNowMs();
  const statuses = versions.map((version) => versionStatus(version, nowMs));
  let nextIndex = -1;
  let nextFrom = Number.POSITIVE_INFINITY;
  statuses.forEach((status, index) => {
    if (status !== "future") return;
    const from = Date.parse(versions[index]?.effective_from ?? "");
    if (from < nextFrom) {
      nextFrom = from;
      nextIndex = index;
    }
  });

  const updateWindow = (index: number, patch: Partial<RateDraft["windows"][number]>): void => {
    const current = draft.windows[index];
    if (current === undefined) return;
    const windows = [...draft.windows];
    windows[index] = { ...current, ...patch };
    setDraft({ ...draft, windows });
  };

  const priceError = (index: number, field: string): string | null =>
    fieldErrors[`price-${String(index)}-${field}`] ?? null;

  const templateButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        // 显式动作：全局参考价（minor→主单位×1e-2），仅填空值不覆盖已填。
        const data = budgetSettingsQuery.data;
        // SettingsValue是五命名空间联合；ai-budget按in收窄取出。
        const settings = data !== undefined && "input_price_per_million_minor" in data.settings
          ? data.settings
          : null;
        if (settings === null) return;
        // 币种守卫：模板价随设置币种计价，跨币种导入=贴错币种标签
        // （PRD §3.3；后端启用端RATE_CURRENCY_MISMATCH）。拒绝导入并说明。
        if (settings.currency !== draft.currency) {
          setTemplateNotice(
            t("admin.providers.pricing.templateCurrencyMismatch", {
              template: settings.currency,
              draft: draft.currency,
            }),
          );
          return;
        }
        setTemplateNotice(null);
        setDraft((current) => {
          const windows = current.windows.map((w, index) =>
            index === 0
              ? {
                  ...w,
                  input_price:
                    w.input_price === "" && settings.input_price_per_million_minor > 0
                      ? (settings.input_price_per_million_minor / 100).toFixed(2)
                      : w.input_price,
                  output_price:
                    w.output_price === "" && settings.output_price_per_million_minor > 0
                      ? (settings.output_price_per_million_minor / 100).toFixed(2)
                      : w.output_price,
                }
              : w,
          );
          return { ...current, windows };
        });
      }}
      data-testid="rate-apply-template"
    >
      <Wand2 aria-hidden />
      {t("admin.providers.pricing.applyTemplate")}
    </Button>
  );

  const submit = () => {
    setErrorText(null);
    setFieldErrors({});
    if (draft.effective_from === "") {
      setErrorText(t("admin.providers.pricing.effectiveFrom"));
      return;
    }
    // 客户端字段校验（镜像合同）：币种由Select约束；时区必填；until不早
    // 于from；四类价格按PRICE_PATTERN逐字段定位（cached可空）。
    const errors: Record<string, string> = {};
    if (draft.timezone.trim() === "") {
      errors.timezone = t("admin.providers.pricing.timezoneRequired");
    }
    if (draft.effective_until !== "" && draft.effective_until < draft.effective_from) {
      errors.effectiveUntil = t("admin.providers.pricing.untilBeforeFrom");
    }
    draft.windows.forEach((w, index) => {
      for (const field of ["input_price", "output_price"] as const) {
        if (!PRICE_PATTERN.test(w[field])) {
          errors[`price-${String(index)}-${field}`] = t("admin.providers.pricing.invalidPrice");
        }
      }
      for (const field of ["cached_read_price", "cached_write_price"] as const) {
        if (w[field] !== "" && !PRICE_PATTERN.test(w[field])) {
          errors[`price-${String(index)}-${field}`] = t("admin.providers.pricing.invalidPrice");
        }
      }
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    const body: CreateAiProviderRateVersionRequest = {
      currency: draft.currency === "USD" ? "USD" : "CNY",
      timezone: draft.timezone,
      // Anchor the picked calendar date at UTC midnight: a local-midnight
      // Date would serialize via toISOString one day early for every
      // timezone east of UTC (the deployment default is Asia/Shanghai).
      effective_from: new Date(`${draft.effective_from}T00:00:00Z`).toISOString(),
      ...(draft.effective_until === ""
        ? {}
        : { effective_until: new Date(`${draft.effective_until}T00:00:00Z`).toISOString() }),
      windows: draft.windows.map((w) => ({
        start_minute: w.start_minute,
        end_minute: w.end_minute,
        input_price: w.input_price,
        output_price: w.output_price,
        ...(w.cached_read_price === "" ? {} : { cached_read_price: w.cached_read_price }),
        ...(w.cached_write_price === "" ? {} : { cached_write_price: w.cached_write_price }),
      })),
    };
    createMutation.mutate(
      { providerId, body },
      {
        onSuccess: () => {
          setShowForm(false);
          setDraft(emptyRateDraft());
          setTemplateNotice(null);
        },
        onError: (error) => {
          setErrorText(describeErrorText(describeError(error, "createAiProviderRateVersion")));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="provider-pricing-panel">
      {/* 常驻声明是静态说明而非动态告警：不占role=alert，把alert语义留给
          真正的表单错误与操作反馈（模板币种冲突等）。 */}
      <div
        className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 text-muted-foreground text-xs"
        data-testid="provider-pricing-declaration"
      >
        {t("admin.providers.pricing.declaration")}
      </div>

      {versionsQuery.isPending ? (
        <LoadingState variant="table" columns={5} />
      ) : versionsQuery.isError ? (
        <ErrorState
          error={versionsQuery.error}
          operationId="listAiProviderRateVersions"
          onRetry={() => { void versionsQuery.refetch(); }}
        />
      ) : versions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("admin.providers.pricing.empty")}</p>
      ) : (
        <Table density="compact" data-testid="provider-rate-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.providers.pricing.version")}</TableHead>
              <TableHead>{t("admin.providers.pricing.currency")}</TableHead>
              <TableHead>{t("admin.providers.pricing.timezone")}</TableHead>
              <TableHead>{t("admin.providers.pricing.effective")}</TableHead>
              <TableHead>{t("admin.providers.pricing.windows")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((version, index) => (
              <TableRow key={version.id} data-testid={`provider-rate-row-${version.id}`}>
                <TableCell className="font-semibold">v{version.version}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{version.currency}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{version.timezone}</TableCell>
                <TableCell className="text-xs">
                  {effectiveText(version)}
                  {statuses[index] === "current" ? (
                    <Badge variant="outline" className="ml-1.5">
                      {t("admin.providers.pricing.current")}
                    </Badge>
                  ) : index === nextIndex ? (
                    <Badge variant="outline" className="ml-1.5">
                      {t("admin.providers.pricing.nextEffective")}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {version.windows
                    .map((w) => `${minuteToHM(w.start_minute)}–${minuteToHM(w.end_minute)}`)
                    .join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!showForm && (
        <div>
          <Button
            type="button"
            size="sm"
            onClick={() => { setShowForm(true); }}
            data-testid="rate-new-version"
          >
            <Plus aria-hidden />
            {t("admin.providers.pricing.newVersion")}
          </Button>
        </div>
      )}

      {showForm && (
        <div className="flex flex-col gap-3 rounded-lg border p-3" data-testid="provider-rate-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rate-currency">{t("admin.providers.pricing.currency")}</Label>
              <Select
                value={draft.currency}
                onValueChange={(value) => {
                  if (value !== "CNY" && value !== "USD") return;
                  // 币种切换使既有模板冲突说明失效。
                  setTemplateNotice(null);
                  setDraft({ ...draft, currency: value });
                }}
              >
                <SelectTrigger id="rate-currency" data-testid="rate-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CNY">CNY</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rate-timezone">{t("admin.providers.pricing.timezone")}</Label>
              <Input
                id="rate-timezone"
                value={draft.timezone}
                onChange={(event) => { setDraft({ ...draft, timezone: event.target.value }); }}
                aria-invalid={fieldErrors.timezone !== undefined}
                data-testid="rate-timezone"
              />
              {fieldErrors.timezone !== undefined && (
                <p className="text-destructive text-xs">{fieldErrors.timezone}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rate-from">{t("admin.providers.pricing.effectiveFrom")}</Label>
              <Input
                id="rate-from"
                type="date"
                value={draft.effective_from}
                onChange={(event) => { setDraft({ ...draft, effective_from: event.target.value }); }}
                data-testid="rate-from"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rate-until">{t("admin.providers.pricing.effectiveUntil")}</Label>
              <Input
                id="rate-until"
                type="date"
                value={draft.effective_until}
                onChange={(event) => { setDraft({ ...draft, effective_until: event.target.value }); }}
                aria-invalid={fieldErrors.effectiveUntil !== undefined}
                data-testid="rate-until"
              />
              {fieldErrors.effectiveUntil !== undefined && (
                <p className="text-destructive text-xs">{fieldErrors.effectiveUntil}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium">
              {t("admin.providers.pricing.window")}
              <span className="ml-2">{t("admin.providers.pricing.unit")}</span>
            </p>
            {templateButton}
          </div>
          <p className="text-muted-foreground -mt-2 text-xs">{t("admin.providers.pricing.templateHint")}</p>
          {templateNotice !== null && (
            <Alert className="-mt-1" data-testid="rate-template-notice">
              <AlertDescription>{templateNotice}</AlertDescription>
            </Alert>
          )}

          {draft.windows.map((window, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-md border p-2.5" data-testid={`rate-window-${String(index)}`}>
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t("admin.providers.pricing.window")}
                  type="time"
                  value={minuteToHM(window.start_minute)}
                  onChange={(event) => {
                    const [h, m] = event.target.value.split(":").map(Number);
                    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
                    const windows = [...draft.windows];
                    windows[index] = { ...window, start_minute: h * 60 + m };
                    setDraft({ ...draft, windows });
                  }}
                  data-testid={`rate-window-start-${String(index)}`}
                  className="w-24 font-mono text-xs"
                />
                <span className="text-muted-foreground text-xs">→</span>
                {/* end_minute合同上限1440（半天开区间[0,1440)的全天终点）：
                    type=time装不下"24:00"（浏览器清空为不可读控件），故终点
                    用文本控件承载数值化解析；起始仍用time控件（0..1439恒可
                    表示）。 */}
                <Input
                  aria-label={`${t("admin.providers.pricing.window")} end`}
                  type="text"
                  inputMode="numeric"
                  value={minuteToHM(window.end_minute)}
                  onChange={(event) => {
                    const minute = parseDayMinute(event.target.value);
                    if (minute === null) return;
                    const windows = [...draft.windows];
                    windows[index] = { ...window, end_minute: minute };
                    setDraft({ ...draft, windows });
                  }}
                  data-testid={`rate-window-end-${String(index)}`}
                  className="w-24 font-mono text-xs"
                />
                {index === 0 && (
                  <span className="text-muted-foreground text-xs">{t("admin.providers.pricing.baseWindow")}</span>
                )}
                <span className="flex-1" />
                {draft.windows.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setDraft({ ...draft, windows: draft.windows.filter((_, i) => i !== index) }); }}
                    aria-label={t("admin.providers.pricing.removeWindow")}
                  >
                    ×
                  </Button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <PriceInput
                  testId={`rate-input-price-${String(index)}`}
                  label={t("admin.providers.pricing.inputPrice")}
                  value={window.input_price}
                  onChange={(value) => { updateWindow(index, { input_price: value }); }}
                  error={priceError(index, "input_price")}
                />
                <PriceInput
                  testId={`rate-output-price-${String(index)}`}
                  label={t("admin.providers.pricing.outputPrice")}
                  value={window.output_price}
                  onChange={(value) => { updateWindow(index, { output_price: value }); }}
                  error={priceError(index, "output_price")}
                />
                <PriceInput
                  testId={`rate-cached-read-${String(index)}`}
                  label={t("admin.providers.pricing.cachedRead")}
                  value={window.cached_read_price}
                  onChange={(value) => { updateWindow(index, { cached_read_price: value }); }}
                  error={priceError(index, "cached_read_price")}
                />
                <PriceInput
                  testId={`rate-cached-write-${String(index)}`}
                  label={t("admin.providers.pricing.cachedWrite")}
                  value={window.cached_write_price}
                  onChange={(value) => { updateWindow(index, { cached_write_price: value }); }}
                  error={priceError(index, "cached_write_price")}
                />
              </div>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">{t("admin.providers.pricing.crossMidnight")}</p>

          {draft.windows.length < 24 && (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const last = draft.windows[draft.windows.length - 1];
                  setDraft({
                    ...draft,
                    windows: [...draft.windows, { ...EMPTY_WINDOW, ...(last !== undefined ? { start_minute: last.end_minute % 1440 } : {}) }],
                  });
                }}
                data-testid="rate-add-window"
              >
                <Plus aria-hidden />
                {t("admin.providers.pricing.addWindow")}
              </Button>
            </div>
          )}

          {errorText !== null && (
            <Alert variant="destructive" data-testid="rate-form-error">
              <AlertTitle>{t("admin.providers.pricing.createFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={createMutation.isPending}
              data-testid="rate-submit"
            >
              {t("common.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setShowForm(false); setErrorText(null); setTemplateNotice(null); }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function basisLabel(basis: AiCallUsage["calc_basis"]): string {
  switch (basis) {
    case "full_detail": return "admin.providers.pricing.basisFull";
    case "partial_detail": return "admin.providers.pricing.basisPartial";
    case "base_only": return "admin.providers.pricing.basisBase";
    default: return "admin.providers.pricing.basisNone";
  }
}

// The OpenAPI doc comment says "null means unknown" while the generated
// type only marks the field optional, and the shared mock world already
// sends explicit null on this shape — the defense covers both encodings.
// Either way the UI must show the not-reported mark, never a literal
// "null" (and never a fabricated zero cost: Number(null) is 0).
function tokenText(value: number | undefined | null, notReported: string): string {
  return value == null ? notReported : String(value);
}

export function ProviderUsagePanel({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const summaryQuery = useAiUsageSummaryToday(true);
  // 明细走合同游标分页（limit≤200，合同上限），provider过滤在整页行上
  // 完成：has_more是全量流的诚实边界，不做静默截断。
  const pager = useCursorPage(200);
  const callsQuery = useAiUsageCalls(true, { limit: pager.pageSize, after: pager.after });
  const notReported = t("admin.providers.pricing.notReported");
  // reference_amount is already a currency-unit decimal string on the wire
  // (OpenAPI: "Bounded decimal reference cost in currency units"; backend
  // formats numeric(24,8) verbatim). Any float round-trip — let alone the
  // old /1e9 nano misread — loses precision, so the string passes through
  // untouched and only the empty string means "not computable".
  const summary = (summaryQuery.data ?? []).map((row) => ({
    ...row,
    amount: row.reference_amount === "" ? null : row.reference_amount,
  }));
  const calls = (callsQuery.data?.items ?? []).filter((call) => call.provider_id === providerId);
  const callsLoaded = !callsQuery.isPending && !callsQuery.isError;

  return (
    <div className="flex flex-col gap-4" data-testid="provider-usage-panel">
      {/* 常驻声明是静态说明而非动态告警：不占role=alert。 */}
      <div className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 text-muted-foreground text-xs">
        {t("admin.providers.pricing.usageDeclaration")}
      </div>

      <div>
        <p className="text-foreground text-sm font-semibold">{t("admin.providers.pricing.usage")}</p>
        <p className="text-muted-foreground text-xs">{t("admin.providers.pricing.usageSummary")}</p>
        <p className="text-muted-foreground text-xs">{t("admin.providers.pricing.summaryScope")}</p>
        {summaryQuery.isPending ? (
          <LoadingState variant="inline" />
        ) : summaryQuery.isError ? (
          <ErrorState
            error={summaryQuery.error}
            operationId="listAiUsageSummary"
            onRetry={() => { void summaryQuery.refetch(); }}
          />
        ) : summary.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">{t("admin.providers.pricing.notComputable")}</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1" data-testid="provider-usage-summary">
            {summary.map((row) => (
              <li key={row.currency} className="text-xs">
                <span className="font-mono font-semibold">{row.currency}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {t("admin.providers.pricing.amount")}: {row.amount === null ? t("admin.providers.pricing.notComputable") : row.amount}
                  {" "}
                  · {t("admin.providers.pricing.basis")}: {row.computable_calls}/{row.calls}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-foreground text-sm font-semibold">{t("admin.providers.pricing.calls")}</p>
        {callsQuery.isPending ? (
          <LoadingState variant="table" columns={8} />
        ) : callsQuery.isError ? (
          <ErrorState
            error={callsQuery.error}
            operationId="listAiUsageCalls"
            onRetry={() => { void callsQuery.refetch(); }}
          />
        ) : calls.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">{t("admin.providers.pricing.empty")}</p>
        ) : (
          <>
          <Table density="compact" className="mt-1.5" data-testid="provider-usage-calls">
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.providers.pricing.callTime")}</TableHead>
                <TableHead>{t("admin.providers.pricing.stageTurn")}</TableHead>
                <TableHead>{t("admin.providers.pricing.params")}</TableHead>
                <TableHead>{t("admin.providers.pricing.rateSource")}</TableHead>
                <TableHead>{t("admin.providers.pricing.tokens")}</TableHead>
                <TableHead>{t("admin.providers.pricing.reasoningTokens")}</TableHead>
                <TableHead>{t("admin.providers.pricing.amount")}</TableHead>
                <TableHead>{t("admin.providers.pricing.basis")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id} data-testid={`provider-usage-row-${call.id}`}>
                  <TableCell className="font-mono text-xs">{call.sent_at.replace("T", " ").slice(0, 19)}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    S{String(call.stage_position)}/T{String(call.model_turn)}#{String(call.call_index)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {call.reasoning_effort ?? "—"} / {tokenText(call.max_tokens, "—")} / {call.temperature ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {call.rate_source === "none"
                      ? t("admin.providers.pricing.none")
                      : call.rate_source === "global_settings"
                        ? t("admin.providers.pricing.globalSettings")
                        : t("admin.providers.pricing.rateVersion")}
                    {call.currency != null ? ` (${call.currency})` : ""}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {tokenText(call.input_tokens, notReported)} / {tokenText(call.output_tokens, notReported)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {tokenText(call.cached_tokens, notReported)} / {tokenText(call.cache_write_tokens, notReported)}
                    {call.reasoning_tokens != null
                      ? ` (R ${String(call.reasoning_tokens)})`
                      : ""}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {call.reference_amount == null || call.reference_amount === ""
                      ? t("admin.providers.pricing.notComputable")
                      : call.reference_amount}
                  </TableCell>
                  <TableCell className="text-xs">{t(basisLabel(call.calc_basis))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {callsLoaded && (
            <TablePagination
              testIdPrefix="provider-usage-calls"
              busy={callsQuery.isFetching && callsQuery.isPlaceholderData}
              page={pager.pageNo}
              hasMore={callsQuery.data.page.has_more}
              isFirst={pager.isFirst}
              onPrev={pager.goPrev}
              onJumpPage={pager.goToPage}
              onNext={() => { pager.pushCursor(callsQuery.data.page.next_cursor); }}
              pageSize={pager.pageSize}
              onPageSizeChange={pager.setPageSize}
              rowsOnPage={calls.length}
            />
          )}
          </>
        )}
      </div>
    </div>
  );
}
