import { useState } from "react";
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

function effectiveText(version: AiProviderRateVersion): string {
  const until = version.effective_until ?? i18next.t("admin.providers.pricing.openEnded");
  return `${version.effective_from.slice(0, 10)} → ${until.slice(0, 10)}`;
}

const EMPTY_WINDOW = {
  start_minute: 0,
  end_minute: 1440,
  input_price: "",
  output_price: "",
  cached_read_price: "",
  cached_write_price: "",
};

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
    if (draft.effective_from === "") {
      setErrorText(t("admin.providers.pricing.effectiveFrom"));
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
        },
        onError: (error) => {
          setErrorText(describeErrorText(describeError(error, "createAiProviderRateVersion")));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="provider-pricing-panel">
      <Alert className="border-border/60 bg-muted/30">
        <AlertDescription className="text-muted-foreground text-xs">
          {t("admin.providers.pricing.declaration")}
        </AlertDescription>
      </Alert>

      {versionsQuery.isPending ? null : versions.length === 0 ? (
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
            {versions.map((version) => (
              <TableRow key={version.id} data-testid={`provider-rate-row-${version.id}`}>
                <TableCell className="font-semibold">v{version.version}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{version.currency}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{version.timezone}</TableCell>
                <TableCell className="text-xs">
                  {effectiveText(version)}
                  {version.effective_until === undefined ? (
                    <Badge variant="outline" className="ml-1.5">
                      {t("admin.providers.pricing.current")}
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
              <Label>{t("admin.providers.pricing.currency")}</Label>
              <Select
                value={draft.currency}
                onValueChange={(value) => { if (value === "CNY" || value === "USD") setDraft({ ...draft, currency: value }); }}
              >
                <SelectTrigger data-testid="rate-currency">
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
                data-testid="rate-timezone"
              />
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
                data-testid="rate-until"
              />
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
                <Input
                  aria-label={`${t("admin.providers.pricing.window")} end`}
                  type="time"
                  value={window.end_minute === 1440 ? "24:00" : minuteToHM(window.end_minute)}
                  onChange={(event) => {
                    const [h, m] = event.target.value.split(":").map(Number);
                    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
                    const windows = [...draft.windows];
                    windows[index] = { ...window, end_minute: Math.min(h * 60 + m, 1440) };
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
                <Input
                  placeholder={t("admin.providers.pricing.inputPrice")}
                  value={window.input_price}
                  onChange={(event) => {
                    const windows = [...draft.windows];
                    windows[index] = { ...window, input_price: event.target.value };
                    setDraft({ ...draft, windows });
                  }}
                  data-testid={`rate-input-price-${String(index)}`}
                  className="font-mono text-xs"
                />
                <Input
                  placeholder={t("admin.providers.pricing.outputPrice")}
                  value={window.output_price}
                  onChange={(event) => {
                    const windows = [...draft.windows];
                    windows[index] = { ...window, output_price: event.target.value };
                    setDraft({ ...draft, windows });
                  }}
                  data-testid={`rate-output-price-${String(index)}`}
                  className="font-mono text-xs"
                />
                <Input
                  placeholder={t("admin.providers.pricing.cachedRead")}
                  value={window.cached_read_price}
                  onChange={(event) => {
                    const windows = [...draft.windows];
                    windows[index] = { ...window, cached_read_price: event.target.value };
                    setDraft({ ...draft, windows });
                  }}
                  data-testid={`rate-cached-read-${String(index)}`}
                  className="font-mono text-xs"
                />
                <Input
                  placeholder={t("admin.providers.pricing.cachedWrite")}
                  value={window.cached_write_price}
                  onChange={(event) => {
                    const windows = [...draft.windows];
                    windows[index] = { ...window, cached_write_price: event.target.value };
                    setDraft({ ...draft, windows });
                  }}
                  data-testid={`rate-cached-write-${String(index)}`}
                  className="font-mono text-xs"
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
              onClick={() => { setShowForm(false); setErrorText(null); }}
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
  const callsQuery = useAiUsageCalls(true);
  const notReported = t("admin.providers.pricing.notReported");
  const summary = (summaryQuery.data ?? []).map((row) => ({
    ...row,
    amount: row.reference_amount === "" ? null : Number(row.reference_amount) / 1e9,
  }));
  const calls = (callsQuery.data ?? []).filter((call) => call.provider_id === providerId);

  return (
    <div className="flex flex-col gap-4" data-testid="provider-usage-panel">
      <Alert className="border-border/60 bg-muted/30">
        <AlertDescription className="text-muted-foreground text-xs">
          {t("admin.providers.pricing.usageDeclaration")}
        </AlertDescription>
      </Alert>

      <div>
        <p className="text-foreground text-sm font-semibold">{t("admin.providers.pricing.usage")}</p>
        <p className="text-muted-foreground text-xs">{t("admin.providers.pricing.usageSummary")}</p>
        {summary.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">{t("admin.providers.pricing.notComputable")}</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1" data-testid="provider-usage-summary">
            {summary.map((row) => (
              <li key={row.currency} className="text-xs">
                <span className="font-mono font-semibold">{row.currency}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {t("admin.providers.pricing.amount")}: {row.amount === null ? t("admin.providers.pricing.notComputable") : row.amount.toFixed(6)}
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
        {calls.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">{t("admin.providers.pricing.empty")}</p>
        ) : (
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
                      : (Number(call.reference_amount) / 1e9).toFixed(8)}
                  </TableCell>
                  <TableCell className="text-xs">{t(basisLabel(call.calc_basis))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
