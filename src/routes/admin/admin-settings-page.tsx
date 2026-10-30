import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import type {
  ExecutionWindowDaysOfWeekItem,
  SettingsImpactAssessment,
  SettingsValue,
  OscOverrides,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { BusinessError } from "@/shared/api/mutator";
import i18next from "@/shared/i18n";
import { describeError } from "@/shared/api/error-display";
import { PageHeader, PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Label } from "@/shared/components/ui/label";
import {
  useAssessSettingsImpact,
  useReplaceSettings,
  useSettingsNamespace,
} from "@/features/admin/use-admin";

/**
 * 设置族 (routes /admin/settings/{general,query,execution,branding}; §2
 * splits legacy /manager/setting into typed namespaces — S006: no RPC,
 * automated-task, query-limit or per-order-budget fields ever return). The F9
 * ai-budget page keeps its dedicated two-step confirmation flow; this
 * generic page serves the remaining four namespaces with the same
 * contract: assess → render effects → high-impact PUT carries the
 * single-use impact_token; PRECONDITION_REQUIRED (1011) drops the stale
 * assessment instead of retrying silently. Field surfaces follow the
 * declared schemas exactly — the deleted legacy knobs (查询最大Limit、
 * 自定义环境、数据清除、AI提示词) have no v4 counterparts and do not
 * render.
 */

import { SettingsNavTabs, type SettingsRouteNamespace } from "@/routes/admin/settings-tabs";

const ROUTE_NAMESPACES: SettingsRouteNamespace[] = ["general", "query", "execution", "branding"];

export default function AdminSettingsNamespacePage() {
  const { namespace = "" } = useParams();
  const { t } = useTranslation();
  if (!ROUTE_NAMESPACES.includes(namespace as SettingsRouteNamespace)) {
    return <Navigate to="/admin/settings/general" replace />;
  }
  const current = namespace as SettingsRouteNamespace;
  // §18.47 follow-up: each namespace is an independent form. Without the
  // key, switching tabs keeps the previous namespace's draft state alive —
  // same version numbers then never trigger the re-seed and the new
  // namespace renders a fieldless card with the old namespace's assessment.
  // Settings-area content transition (owner ruling 2026-10-24): the tab bar
  // header above stays static; only the namespace subtree — which remounts by
  // key to reset its form state — fades/rises between namespaces.
  return (
    <PageLayout data-testid={`admin-settings-${current}`}>
      <PageHeader
        title={t(`adminSettings.${current}.title`)}
        description={t(`adminSettings.${current}.description`)}
        icon={SlidersHorizontal}
        actions={<SettingsNavTabs current={current} />}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={namespace}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <NamespaceSettings key={namespace} namespace={namespace as SettingsRouteNamespace} />
        </motion.div>
      </AnimatePresence>
    </PageLayout>
  );
}

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

function NamespaceSettings({ namespace }: { namespace: SettingsRouteNamespace }) {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const settingsQuery = useSettingsNamespace(namespace, isAdmin);
  const assessMutation = useAssessSettingsImpact();
  const replaceMutation = useReplaceSettings();
  const [draftFor, setDraftFor] = useState<number | null>(null);
  const [draft, setDraft] = useState<SettingsValue | null>(null);
  const [assessment, setAssessment] = useState<SettingsImpactAssessment | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  // Draft initialization keyed by the loaded namespace version: a remount
  // or a reload after save re-seeds the form exactly once, without a
  // setState-in-effect cascade. The saved note and the (auto-generated)
  // assessment intentionally survive the post-save re-seed — both hide on
  // their own once the form goes dirty again; wiping them here made every
  // successful save look like a silent no-op (§18.47 follow-up).
  if (settingsQuery.data !== undefined && draftFor !== settingsQuery.data.version) {
    setDraftFor(settingsQuery.data.version);
    setDraft(structuredClone(settingsQuery.data.settings));
  }

  const dirty = useMemo(() => {
    if (draft === null || settingsQuery.data === undefined) return false;
    return JSON.stringify(draft) !== JSON.stringify(settingsQuery.data.settings);
  }, [draft, settingsQuery.data]);

  const highImpact = assessment?.impact.level === "high";

  // High-impact saves need a one-time impact token. Rather than making the
  // user run the assess ceremony by hand, a PRECONDITION_REQUIRED (1011)
  // answer triggers exactly one automatic assess → retry cycle with the
  // fresh token (server-driven: the client never guesses impact levels);
  // the resulting assessment renders so the effects are still shown.
  const save = (impactToken: string | null): void => {
    if (draft === null) return;
    setErrorText(null);
    replaceMutation.mutate(
      {
        namespace,
        version: settingsQuery.data === undefined ? 1 : settingsQuery.data.version,
        settings: draft,
        impactToken,
      },
      {
        onSuccess: () => {
          setSavedNote(true);
        },
        onError: (error) => {
          if (error instanceof BusinessError && error.err_code === 1011 && impactToken === null) {
            assessMutation.mutate(
              { namespace, settings: draft },
              {
                onSuccess: (next) => {
                  setAssessment(next);
                  save(next.impact_token);
                },
                onError: (assessError) => {
                  setErrorText(describeErrorText(describeError(assessError, "assessSettingsImpact")));
                },
              },
            );
            return;
          }
          setErrorText(describeErrorText(describeError(error, "replaceSettingsNamespace")));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {settingsQuery.isPending && <LoadingState variant="panel" columns={2} />}
      {settingsQuery.error !== null && (
        <ErrorState
          error={settingsQuery.error}
          operationId="getSettingsNamespace"
          onRetry={() => void settingsQuery.refetch()}
        />
      )}

      {draft !== null && (
        <Card>
          {/* §18.55: the redundant inner card header（设置表单/按声明Schema编辑）
              was removed by owner ruling — the page header already names the
              namespace. */}
          <CardContent className="flex flex-col gap-4">
            {namespace === "general" && <GeneralFields draft={draft} setDraft={setDraft} />}
            {namespace === "query" && <QueryFields draft={draft} setDraft={setDraft} />}
            {namespace === "execution" && <ExecutionFields draft={draft} setDraft={setDraft} />}
            {namespace === "branding" && <BrandingFields draft={draft} setDraft={setDraft} />}

            {assessment !== null && (
              <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="settings-assessment">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={highImpact ? "destructive" : "secondary"}>
                    {t("adminSettings.assessment.level", { level: assessment.impact.level })}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {t("adminSettings.assessment.expiresAt", {
                      time: assessment.expires_at.replace("T", " ").replace("Z", " UTC"),
                    })}
                  </span>
                </div>
                <ul className="text-muted-foreground list-disc pl-4 text-xs">
                  {assessment.impact.effects.map((effect, index) => (
                    <li key={index}>
                      {effect.kind} × {effect.count} — {effect.consequence}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {savedNote && !dirty && (
              <p className="text-xs" data-testid="settings-saved-note">
                {t("adminSettings.saved")}
              </p>
            )}
            {errorText !== null && (
              <Alert variant="destructive" data-testid="settings-error">
                <AlertTitle>{t("adminSettings.saveFailed")}</AlertTitle>
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            )}

            {namespace === "general" && !timezoneStructureOk(generalTimezoneOf(draft)) && (
              <Alert variant="destructive" data-testid="settings-timezone-blocked">
                <AlertTitle>{t("adminSettings.saveFailed")}</AlertTitle>
                <AlertDescription>{t("adminSettings.general.timezoneInvalid")}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <PendingButton
                variant="outline"
                disabled={!dirty || assessMutation.isPending || (namespace === "general" && !timezoneStructureOk(generalTimezoneOf(draft)))}
                pending={assessMutation.isPending}
                onClick={() => {
                  assessMutation.mutate(
                    { namespace, settings: draft },
                    {
                      onSuccess: (next) => { setAssessment(next); },
                      onError: (error) => {
                        setErrorText(describeErrorText(describeError(error, "assessSettingsImpact")));
                      },
                    },
                  );
                }}
                data-testid="settings-assess"
              >
                {t("adminSettings.assess")}
              </PendingButton>
              <PendingButton
                disabled={!dirty || replaceMutation.isPending || assessMutation.isPending || (namespace === "general" && !timezoneStructureOk(generalTimezoneOf(draft)))}
                pending={replaceMutation.isPending}
                onClick={() => { save(assessment !== null && highImpact ? assessment.impact_token : null); }}
                data-testid="settings-save"
              >
                {t("common.save")}
              </PendingButton>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type DraftSetter = (next: SettingsValue) => void;

/** F-SET-001：时区结构校验（与后端结构规则同形——非空段、字符集、
 * 非"Local"、长度；IANA区域名是否真实存在由服务端权威判定并回显错误）。 */
function timezoneStructureOk(value: string): boolean {
  if (value === "" || value.length > 64 || value === "Local") return false;
  if (value.split("/").some((segment) => segment === "")) return false;
  return /^[A-Za-z0-9_+/-]+$/.test(value);
}

/** `SettingsValue` 是五命名空间联合类型；general 面板的守卫只在
 * namespace==="general" 时读取时区字段，用 in 收窄安全取出。 */
function generalTimezoneOf(draft: SettingsValue): string {
  return "system_timezone" in draft ? draft.system_timezone : "";
}

function GeneralFields({ draft, setDraft }: { draft: SettingsValue; setDraft: DraftSetter }) {
  const { t } = useTranslation();
  if (!("registration_enabled" in draft)) return null;
  return (
    <>
      <div className="flex items-center gap-2">
        <Checkbox
          id="settings-general-registration"
          checked={draft.registration_enabled}
          onCheckedChange={(checked) => { setDraft({ ...draft, registration_enabled: checked }); }}
          data-testid="settings-general-registration"
        />
        <Label htmlFor="settings-general-registration" className="cursor-pointer">
          {t("adminSettings.general.registration")}
        </Label>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-general-timezone">{t("adminSettings.general.timezone")}</Label>
        <Input
          id="settings-general-timezone"
          value={draft.system_timezone}
          onChange={(event) => { setDraft({ ...draft, system_timezone: event.target.value }); }}
          maxLength={64}
          aria-invalid={!timezoneStructureOk(draft.system_timezone)}
          data-testid="settings-general-timezone"
        />
        {!timezoneStructureOk(draft.system_timezone) && (
          <p className="text-destructive text-xs" data-testid="settings-general-timezone-error">
            {t("adminSettings.general.timezoneInvalid")}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-general-locale">{t("adminSettings.general.locale")}</Label>
        <Select
          value={draft.default_locale}
          onValueChange={(value) => {
            if (value !== "zh-CN" && value !== "en-US") return;
            setDraft({ ...draft, default_locale: value });
          }}
        >
          <SelectTrigger
            id="settings-general-locale"
            className="w-48"
            data-testid="settings-general-locale"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">zh-CN</SelectItem>
            <SelectItem value="en-US">en-US</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function QueryFields({ draft, setDraft }: { draft: SettingsValue; setDraft: DraftSetter }) {
  const { t } = useTranslation();
  if (!("approval_enabled" in draft)) return null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="settings-query-approval"
            checked={draft.approval_enabled}
            onCheckedChange={(checked) => { setDraft({ ...draft, approval_enabled: checked }); }}
            data-testid="settings-query-approval"
          />
          <Label htmlFor="settings-query-approval" className="cursor-pointer">
            {t("adminSettings.query.approval")}
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">{t("adminSettings.query.approvalHint")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-query-timeout">{t("adminSettings.query.timeout")}</Label>
        <Input
          id="settings-query-timeout"
          type="number"
          min={1}
          max={300000}
          value={draft.default_timeout_ms}
          onChange={(event) => { setDraft({ ...draft, default_timeout_ms: Number(event.target.value) }); }}
          data-testid="settings-query-timeout"
        />
        <p className="text-muted-foreground text-xs">{t("adminSettings.query.timeoutHint")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-query-duration">{t("adminSettings.query.maxDuration")}</Label>
        <Input
          id="settings-query-duration"
          type="number"
          min={1}
          max={525600}
          value={draft.maximum_approved_access_duration_minutes}
          onChange={(event) => { setDraft({ ...draft, maximum_approved_access_duration_minutes: Number(event.target.value) }); }
          }
          data-testid="settings-query-duration"
        />
      </div>
      <Alert>
        <AlertDescription data-testid="settings-query-no-limit">{t("adminSettings.query.noLimitNote")}</AlertDescription>
      </Alert>
    </>
  );
}

function ExecutionFields({ draft, setDraft }: { draft: SettingsValue; setDraft: DraftSetter }) {
  const { t } = useTranslation();
  if (!("restriction_enabled" in draft)) return null;

  /** 空值剔除：OscOverrides全键可选，空串不发送（pattern会拒""）。
   * exec捕获in-收窄后的ExecutionSettings（闭包内对参数的收窄不保持）。 */
  const exec = draft;
  function setOscDefault(key: "max_load" | "critical_load" | "chunk_size" | "max_lag" | "retries", raw: string): void {
    const trimmed = raw.trim();
    const previous: OscOverrides = exec.osc.defaults;
    // 解构剔除动态键（no-dynamic-delete）。
    const { [key]: _removed, ...rest } = previous;
    const base: OscOverrides = rest;
    if (key === "max_load" || key === "critical_load") {
      if (trimmed !== "") base[key] = trimmed;
    } else {
      const parsed = Number(trimmed);
      if (trimmed !== "" && !Number.isNaN(parsed)) base[key] = parsed;
    }
    setDraft({ ...exec, osc: { ...exec.osc, defaults: base } });
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="settings-execution-restriction"
            checked={draft.restriction_enabled}
            onCheckedChange={(checked) => { setDraft({ ...draft, restriction_enabled: checked }); }}
            data-testid="settings-execution-restriction"
          />
          <Label htmlFor="settings-execution-restriction" className="cursor-pointer">
            {t("adminSettings.execution.restriction")}
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">{t("adminSettings.execution.restrictionHint")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t("adminSettings.execution.windows")}</Label>
        <p className="text-muted-foreground text-xs">{t("adminSettings.execution.windowsHint")}</p>
        <div className="flex flex-col gap-1">
          {draft.windows.map((window, index) => (
            <div key={index} className="flex items-center gap-2 text-xs">
              <Input
                value={window.start_local_time}
                onChange={(event) => {
                  const windows = [...draft.windows];
                  windows[index] = { ...window, start_local_time: event.target.value };
                  setDraft({ ...draft, windows });
                }}
                className="h-8 font-mono text-xs"
                placeholder="HH:MM"
              />
              <span>→</span>
              <Input
                value={window.end_local_time}
                onChange={(event) => {
                  const windows = [...draft.windows];
                  windows[index] = { ...window, end_local_time: event.target.value };
                  setDraft({ ...draft, windows });
                }}
                className="h-8 font-mono text-xs"
                placeholder="HH:MM"
              />
              <Input
                value={window.days_of_week.join(",")}
                onChange={(event) => {
                  const windows = [...draft.windows];
                  windows[index] = {
                    ...window,
                    days_of_week: event.target.value
                    .split(",")
                    .map((day) => day.trim())
                    .filter((day): day is ExecutionWindowDaysOfWeekItem => day !== ""),
                  };
                  setDraft({ ...draft, windows });
                }}
                className="h-8 font-mono text-xs"
                placeholder={t("adminSettings.execution.weekdays")}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => { setDraft({ ...draft, windows: draft.windows.filter((_, i) => i !== index) }); }}
              >
                ×
              </Button>
            </div>
          ))}
          {draft.windows.length < 14 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setDraft({
                  ...draft,
                  windows: [
                    ...draft.windows,
                    { days_of_week: ["monday"] as ExecutionWindowDaysOfWeekItem[], start_local_time: "02:00", end_local_time: "06:00" },
                  ],
                }); }
              }
              data-testid="settings-execution-add-window"
            >
              {t("adminSettings.execution.addWindow")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t("adminSettings.execution.oscTool")}</Label>
        {/* §18.59：Base UI Select + gh-ost选中时展开typed参数输入
            （OscOverrides五键，契约已声明；空值不发送）。 */}
        <Select
          value={draft.osc.tool === "none" ? undefined : draft.osc.tool}
          onValueChange={(value) => { setDraft({ ...draft, osc: { ...draft.osc, tool: value ?? "none" } }); }}
          items={{ "gh-ost": "gh-ost" }}
        >
          <SelectTrigger
            className="h-9 w-40 text-sm"
            aria-label={t("adminSettings.execution.oscTool")}
            data-testid="settings-execution-osc"
          >
            <SelectValue placeholder="none" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gh-ost">gh-ost</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{t("adminSettings.execution.oscHint")}</p>
        {draft.osc.tool === "gh-ost" && (
          <div className="mt-1 flex flex-col gap-3 rounded-md border p-3" data-testid="settings-osc-defaults">
            <p className="text-muted-foreground text-xs">{t("adminSettings.execution.oscDefaultsHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <OscTextField
                label={t("adminSettings.execution.oscMaxLoad")}
                placeholder="Threads_running=50"
                value={draft.osc.defaults.max_load ?? ""}
                onChange={(next) => { setOscDefault("max_load", next); }}
                testId="settings-osc-max-load"
              />
              <OscTextField
                label={t("adminSettings.execution.oscCriticalLoad")}
                placeholder="Threads_running=100"
                value={draft.osc.defaults.critical_load ?? ""}
                onChange={(next) => { setOscDefault("critical_load", next); }}
                testId="settings-osc-critical-load"
              />
              <OscNumberField
                label={t("adminSettings.execution.oscChunkSize")}
                value={draft.osc.defaults.chunk_size === undefined ? "" : String(draft.osc.defaults.chunk_size)}
                onChange={(next) => { setOscDefault("chunk_size", next); }}
                testId="settings-osc-chunk-size"
              />
              <OscNumberField
                label={t("adminSettings.execution.oscMaxLag")}
                value={draft.osc.defaults.max_lag === undefined ? "" : String(draft.osc.defaults.max_lag)}
                onChange={(next) => { setOscDefault("max_lag", next); }}
                testId="settings-osc-max-lag"
              />
              <OscNumberField
                label={t("adminSettings.execution.oscRetries")}
                value={draft.osc.defaults.retries === undefined ? "" : String(draft.osc.defaults.retries)}
                onChange={(next) => { setOscDefault("retries", next); }}
                testId="settings-osc-retries"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function OscTextField({ label, placeholder, value, onChange, testId }: {
  label: string; placeholder: string; value: string; onChange: (next: string) => void; testId: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={testId} className="text-xs">{label}</Label>
      <Input id={testId} value={value} placeholder={placeholder} onChange={(event) => { onChange(event.target.value); }} className="h-8 font-mono text-xs" data-testid={testId} />
    </div>
  );
}

function OscNumberField({ label, value, onChange, testId }: {
  label: string; value: string; onChange: (next: string) => void; testId: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={testId} className="text-xs">{label}</Label>
      <Input id={testId} type="number" value={value} onChange={(event) => { onChange(event.target.value); }} className="h-8 text-xs" data-testid={testId} />
    </div>
  );
}

function BrandingFields({ draft, setDraft }: { draft: SettingsValue; setDraft: DraftSetter }) {
  const { t } = useTranslation();
  if (!("product_name" in draft)) return null;
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-branding-name">{t("adminSettings.branding.productName")}</Label>
        <Input
          id="settings-branding-name"
          value={draft.product_name}
          onChange={(event) => { setDraft({ ...draft, product_name: event.target.value }); }}
          maxLength={64}
          data-testid="settings-branding-name"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-branding-description">{t("adminSettings.branding.loginDescription")}</Label>
        <Input
          id="settings-branding-description"
          value={draft.login_description}
          onChange={(event) => { setDraft({ ...draft, login_description: event.target.value }); }}
          maxLength={500}
          data-testid="settings-branding-description"
        />
      </div>
      <p className="text-muted-foreground text-xs">{t("adminSettings.branding.assetsNote")}</p>
    </>
  );
}
