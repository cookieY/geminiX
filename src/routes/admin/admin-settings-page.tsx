import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router";
import type {
  ExecutionWindowDaysOfWeekItem,
  SettingsImpactAssessment,
  SettingsValue,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
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

export type SettingsRouteNamespace = "general" | "query" | "execution" | "branding";

const ROUTE_NAMESPACES: SettingsRouteNamespace[] = ["general", "query", "execution", "branding"];

export default function AdminSettingsNamespacePage() {
  const { namespace = "" } = useParams();
  if (!ROUTE_NAMESPACES.includes(namespace as SettingsRouteNamespace)) {
    return <Navigate to="/admin/settings/general" replace />;
  }
  return <NamespaceSettings namespace={namespace as SettingsRouteNamespace} />;
}

function NamespaceSettings({ namespace }: { namespace: SettingsRouteNamespace }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  // setState-in-effect cascade.
  if (settingsQuery.data !== undefined && draftFor !== settingsQuery.data.version) {
    setDraftFor(settingsQuery.data.version);
    setDraft(structuredClone(settingsQuery.data.settings));
    setAssessment(null);
    setSavedNote(false);
  }

  const dirty = useMemo(() => {
    if (draft === null || settingsQuery.data === undefined) return false;
    return JSON.stringify(draft) !== JSON.stringify(settingsQuery.data.settings);
  }, [draft, settingsQuery.data]);

  const highImpact = assessment?.impact.level === "high";

  const save = () => {
    if (draft === null) return;
    setErrorText(null);
    replaceMutation.mutate(
      {
        namespace,
        version: settingsQuery.data === undefined ? 1 : settingsQuery.data.version,
        settings: draft,
        impactToken: assessment !== null && highImpact ? assessment.impact_token : null,
      },
      {
        onSuccess: () => {
          setAssessment(null);
          setSavedNote(true);
        },
        onError: (error) => {
          const display = describeError(error, "replaceSettingsNamespace");
          setErrorText(`${display.messageKey}${display.requestId === null ? "" : ` (${display.requestId})`}`);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid={`admin-settings-${namespace}`}>
      <PageBreadcrumb title={t("nav.admin.settings")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t(`adminSettings.${namespace}.title`)}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t(`adminSettings.${namespace}.description`)}</p>
        </div>
        <Tabs defaultValue={namespace}>
          <TabsList>
            <TabsTrigger value="general" onClick={() => { void navigate("/admin/settings/general"); }}>
              {t("adminSettings.tab.general")}
            </TabsTrigger>
            <TabsTrigger value="query" onClick={() => { void navigate("/admin/settings/query"); }}>
              {t("adminSettings.tab.query")}
            </TabsTrigger>
            <TabsTrigger value="execution" onClick={() => { void navigate("/admin/settings/execution"); }}>
              {t("adminSettings.tab.execution")}
            </TabsTrigger>
            <TabsTrigger value="branding" onClick={() => { void navigate("/admin/settings/branding"); }}>
              {t("adminSettings.tab.branding")}
            </TabsTrigger>
            <TabsTrigger value="ai-budget" onClick={() => { void navigate("/admin/settings/ai-budget"); }}>
              {t("adminSettings.tab.aiBudget")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {settingsQuery.isPending && <LoadingState />}
      {settingsQuery.error !== null && (
        <ErrorState
          error={settingsQuery.error}
          operationId="getSettingsNamespace"
          onRetry={() => void settingsQuery.refetch()}
        />
      )}

      {draft !== null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("adminSettings.form")}</CardTitle>
            <CardDescription>{t("adminSettings.formDescription")}</CardDescription>
          </CardHeader>
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

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={!dirty || assessMutation.isPending}
                onClick={() => {
                  assessMutation.mutate(
                    { namespace, settings: draft },
                    {
                      onSuccess: (next) => { setAssessment(next); },
                      onError: (error) => {
                        const display = describeError(error, "assessSettingsImpact");
                        setErrorText(
                          `${display.messageKey}${display.requestId === null ? "" : ` (${display.requestId})`}`,
                        );
                      },
                    },
                  );
                }}
                data-testid="settings-assess"
              >
                {t("adminSettings.assess")}
              </Button>
              <Button disabled={!dirty || replaceMutation.isPending} onClick={save} data-testid="settings-save">
                {replaceMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type DraftSetter = (next: SettingsValue) => void;

function GeneralFields({ draft, setDraft }: { draft: SettingsValue; setDraft: DraftSetter }) {
  const { t } = useTranslation();
  if (!("registration_enabled" in draft)) return null;
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.registration_enabled}
          onChange={(event) => { setDraft({ ...draft, registration_enabled: event.target.checked }); }}
          data-testid="settings-general-registration"
        />
        {t("adminSettings.general.registration")}
      </label>
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-general-timezone">{t("adminSettings.general.timezone")}</Label>
        <Input
          id="settings-general-timezone"
          value={draft.system_timezone}
          onChange={(event) => { setDraft({ ...draft, system_timezone: event.target.value }); }}
          maxLength={255}
          data-testid="settings-general-timezone"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t("adminSettings.general.locale")}</Label>
        <select
          value={draft.default_locale}
          onChange={(event) => { setDraft({ ...draft, default_locale: event.target.value as "zh-CN" | "en-US" }); }
          }
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          data-testid="settings-general-locale"
        >
          <option value="zh-CN">zh-CN</option>
          <option value="en-US">en-US</option>
        </select>
      </div>
    </>
  );
}

function QueryFields({ draft, setDraft }: { draft: SettingsValue; setDraft: DraftSetter }) {
  const { t } = useTranslation();
  if (!("approval_enabled" in draft)) return null;
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.approval_enabled}
          onChange={(event) => { setDraft({ ...draft, approval_enabled: event.target.checked }); }}
          data-testid="settings-query-approval"
        />
        {t("adminSettings.query.approval")}
      </label>
      <p className="text-muted-foreground text-xs">{t("adminSettings.query.approvalHint")}</p>
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
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.restriction_enabled}
          onChange={(event) => { setDraft({ ...draft, restriction_enabled: event.target.checked }); }}
          data-testid="settings-execution-restriction"
        />
        {t("adminSettings.execution.restriction")}
      </label>
      <p className="text-muted-foreground text-xs">{t("adminSettings.execution.restrictionHint")}</p>
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
        <select
          value={draft.osc.tool}
          onChange={(event) => { setDraft({ ...draft, osc: { ...draft.osc, tool: event.target.value as "none" | "gh-ost" } }); }}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          data-testid="settings-execution-osc"
        >
          <option value="none">none</option>
          <option value="gh-ost">gh-ost</option>
        </select>
        <p className="text-muted-foreground text-xs">{t("adminSettings.execution.oscHint")}</p>
      </div>
    </>
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
