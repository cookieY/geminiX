import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, ShieldAlert } from "lucide-react";
import type {
  AiBudgetSettings,
  SettingsImpactAssessment,
  SettingsValue,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useAssessSettingsImpact,
  useReplaceSettings,
  useSettingsNamespace,
  useSettingsRevisions,
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

/**
 * AI预算 settings namespace (route /admin/settings/ai-budget; migration
 * contract §2 splits the legacy /manager/setting into per-namespace pages).
 * R008 boundary made visible: only a global daily AI cost budget and a
 * provider cost alert threshold exist — no per-order token or cost budget
 * is configurable anywhere, and the page states that boundary explicitly.
 *
 * High-impact changes (enforced — impact "immediate") follow the two-step
 * confirmation contract (PRD 10 §4): the full proposed settings go to
 * impact-assessments first, the returned effects are rendered, and the
 * single-use impact_token rides the PUT. PRECONDITION_REQUIRED (1011) on
 * save means the token expired, was consumed or the proposal changed — the
 * page drops the displayed assessment instead of retrying silently.
 * Low-impact changes (currency/budget/threshold) save without a token.
 */

const CURRENCIES = ["USD", "CNY", "EUR", "JPY", "GBP"] as const;

function formFor(settings: AiBudgetSettings): AiBudgetSettings {
  return { ...settings };
}

function AiBudgetPanel({
  namespace,
  current,
  saving,
  onSave,
}: {
  namespace: "general" | "query" | "execution" | "ai-budget" | "branding";
  current: {
    namespace: string;
    schema_version: number;
    settings: SettingsValue;
    version: number;
    updated_by: string;
    updated_at: string;
  };
  saving: boolean;
  /** Resolves false when the server rejected the save (e.g. a consumed
   * impact token) so the panel drops its stale assessment. */
  onSave: (settings: AiBudgetSettings, impactToken: string | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const assessMutation = useAssessSettingsImpact();
  // Keyed by the saved version in the parent: the form re-initializes from
  // the aggregate only when a save actually lands, never mid-edit.
  const [form, setForm] = useState<AiBudgetSettings>(() => formFor(current.settings as AiBudgetSettings));
  const [assessment, setAssessment] = useState<SettingsImpactAssessment | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(current.settings);

  const assess = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    assessMutation.mutate(
      { namespace, settings: form },
      {
        onSuccess: (result) => {
          setAssessment(result);
        },
        onError: (error) => {
          const display = describeError(error, "assessSettingsImpact");
          setErrorKey(display.messageKey);
          setErrorRequestId(display.requestId);
        },
      },
    );
  };


  return (
    <CardContent className="flex flex-col gap-4">
      <Alert data-testid="ai-budget-r008-note">
        <ShieldAlert />
        <AlertTitle>{t("admin.aiBudget.r008Title")}</AlertTitle>
        <AlertDescription>{t("admin.aiBudget.r008Body")}</AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex items-center gap-2 md:col-span-2">
          <input
            type="checkbox"
            id="ai-budget-enforced"
            checked={form.enforced}
            onChange={(event) => { setForm({ ...form, enforced: event.target.checked }); }}
            className="size-4"
            data-testid="ai-budget-enforced"
          />
          <Label htmlFor="ai-budget-enforced" className="cursor-pointer">
            {t("admin.aiBudget.enforced")}
          </Label>
          <p className="text-muted-foreground text-xs">{t("admin.aiBudget.enforcedHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t("admin.aiBudget.currency")}</Label>
          <Select
            value={form.currency}
            onValueChange={(next) => {
              if (next === "" || next === null) return;
              setForm({ ...form, currency: next });
            }}
          >
            <SelectTrigger data-testid="ai-budget-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((currency) => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-budget-daily">{t("admin.aiBudget.dailyBudget")}</Label>
          <Input
            id="ai-budget-daily"
            type="number"
            min={1}
            value={form.daily_budget_minor}
            onChange={(event) => { setForm({ ...form, daily_budget_minor: Number(event.target.value) }); }}
            data-testid="ai-budget-daily"
          />
          <p className="text-muted-foreground text-xs">{t("admin.aiBudget.minorUnitsHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-budget-alert">{t("admin.aiBudget.alertThreshold")}</Label>
          <Input
            id="ai-budget-alert"
            type="number"
            min={1}
            max={100}
            value={form.alert_threshold_percent}
            onChange={(event) => {
              setForm({ ...form, alert_threshold_percent: Number(event.target.value) });
            }}
            data-testid="ai-budget-alert"
          />
          <p className="text-muted-foreground text-xs">{t("admin.aiBudget.alertHint")}</p>
        </div>
      </div>
      {errorKey !== null ? (
        <Alert variant="destructive" data-testid="ai-budget-error">
          <AlertTitle>{t(errorKey)}</AlertTitle>
          <AlertDescription>
            {errorRequestId !== null ? `request_id: ${errorRequestId}` : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {assessment === null ? (
        <div className="flex items-center gap-2">
          <Button onClick={assess} disabled={!dirty || assessMutation.isPending} data-testid="ai-budget-assess">
            {t("admin.aiBudget.assess")}
          </Button>
          {dirty ? <p className="text-muted-foreground text-xs">{t("admin.aiBudget.dirtyHint")}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="ai-budget-assessment">
          <div className="flex items-center gap-2">
            <Badge
              variant={assessment.impact.level === "high" ? "destructive" : "secondary"}
              data-testid="ai-budget-impact-level"
            >
              {t(`admin.aiBudget.impactLevel.${assessment.impact.level}`)}
            </Badge>
            <span className="text-muted-foreground font-mono text-xs">
              {assessment.impact.changed_paths.join(", ")}
            </span>
          </div>
          {assessment.impact.level === "high" ? (
            <>
              <ul className="list-disc pl-4 text-xs">
                {assessment.impact.effects.map((effect) => (
                  <li key={`${effect.kind}-${String(effect.count)}-${effect.consequence}`}>
                    {t("admin.aiBudget.effectLine", {
                      kind: t(`admin.aiBudget.effectKind.${effect.kind}`),
                      count: effect.count,
                      consequence: t(`admin.aiBudget.consequence.${effect.consequence}`),
                    })}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">{t("admin.aiBudget.confirmHint")}</p>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    void onSave(form, assessment.impact_token).then((ok) => {
                      if (!ok) setAssessment(null);
                    });
                  }}
                  disabled={saving}
                  data-testid="ai-budget-confirm"
                >
                  {t("admin.aiBudget.confirmSave")}
                </Button>
                <Button variant="outline" onClick={() => { setAssessment(null); }}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={() => { void onSave(form, null); }}
                disabled={saving}
                data-testid="ai-budget-save-low"
              >
                {t("common.save")}
              </Button>
              <Button variant="outline" onClick={() => { setAssessment(null); }}>
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </div>
      )}
    </CardContent>
  );
}

export default function AdminAiBudgetPage() {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const namespace = "ai-budget" as const;
  const query = useSettingsNamespace(namespace, enabled);
  const revisionsQuery = useSettingsRevisions(namespace, enabled);
  const replaceMutation = useReplaceSettings();
  const [savedTick, setSavedTick] = useState(0);
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null);
  const [saveErrorRequestId, setSaveErrorRequestId] = useState<string | null>(null);

  const save = async (settings: AiBudgetSettings, impactToken: string | null): Promise<boolean> => {
    setSaveErrorKey(null);
    setSaveErrorRequestId(null);
    if (query.data === undefined) return false;
    try {
      await replaceMutation.mutateAsync({
        namespace,
        version: query.data.version,
        settings,
        impactToken,
      });
      setSavedTick((tick) => tick + 1);
      return true;
    } catch (error) {
      // A consumed/expired token (PRECONDITION_REQUIRED) invalidates the
      // displayed assessment — the admin re-assesses, no silent retry.
      const display = describeError(error, "replaceSettingsNamespace");
      setSaveErrorKey(display.messageKey);
      setSaveErrorRequestId(display.requestId);
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("admin.aiBudget.title")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("admin.aiBudget.title")}
            {query.data !== undefined ? (
              <Badge variant="outline" data-testid="ai-budget-version">
                {t("admin.aiBudget.version", { version: query.data.version })}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>{t("admin.aiBudget.description")}</CardDescription>
        </CardHeader>
        {query.isPending ? (
          <CardContent>
            <LoadingState />
          </CardContent>
        ) : query.isError ? (
          <CardContent>
            <ErrorState
              error={query.error}
              operationId="getSettingsNamespace"
              onRetry={() => void query.refetch()}
            />
          </CardContent>
        ) : (
          <CardContent className="flex flex-col gap-4">
            <AiBudgetPanel
              key={query.data.version}
              namespace={namespace}
              current={query.data}
              saving={replaceMutation.isPending}
              onSave={save}
            />
            {saveErrorKey !== null ? (
              <Alert variant="destructive" data-testid="ai-budget-error">
                <AlertTitle>{t(saveErrorKey)}</AlertTitle>
                <AlertDescription>
                  {saveErrorRequestId !== null ? `request_id: ${saveErrorRequestId}` : null}
                  {saveErrorKey === "errors.PRECONDITION_REQUIRED" ? (
                    <span className="block">{t("admin.aiBudget.preconditionHint")}</span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {savedTick > 0 && saveErrorKey === null ? (
              <p className="text-[var(--risk-safe)]" data-testid="ai-budget-saved">
                {t("admin.aiBudget.saved")}
              </p>
            ) : null}
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" /> {t("admin.aiBudget.revisionsTitle")}
          </CardTitle>
          <CardDescription>{t("admin.aiBudget.revisionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {revisionsQuery.isPending ? (
            <LoadingState />
          ) : revisionsQuery.isError ? (
            <ErrorState
              error={revisionsQuery.error}
              operationId="listSettingsRevisions"
              onRetry={() => void revisionsQuery.refetch()}
            />
          ) : revisionsQuery.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("admin.aiBudget.revisionsEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.aiBudget.revisionVersion")}</TableHead>
                  <TableHead>{t("admin.aiBudget.revisionChangedBy")}</TableHead>
                  <TableHead>{t("admin.aiBudget.revisionChangedAt")}</TableHead>
                  <TableHead>{t("admin.aiBudget.revisionPaths")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisionsQuery.data.map((revision) => (
                  <TableRow key={revision.version} data-testid={`ai-budget-revision-${String(revision.version)}`}>
                    <TableCell className="font-mono text-xs">v{revision.version}</TableCell>
                    <TableCell className="font-mono text-xs">{revision.changed_by}</TableCell>
                    <TableCell className="text-xs">{revision.changed_at}</TableCell>
                    <TableCell className="font-mono text-xs">{revision.changed_paths.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
