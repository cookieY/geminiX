import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { CircleDollarSign, History, ShieldAlert } from "lucide-react";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ChartContainer, type ChartConfig } from "@/shared/components/ui/chart";
import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import type {
  AiBudgetSettings,
  SettingsImpactAssessment,
  SettingsValue,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useAiUsageSummaryToday,
  useAssessSettingsImpact,
  useReplaceSettings,
  useSettingsNamespace,
  useSettingsRevisions,
} from "@/features/admin/use-admin";
import { useSession } from "@/features/auth/session-provider";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import { describeError } from "@/shared/api/error-display";
import { PageHeader, PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
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
 * AI预算 settings namespace (route /admin/review-engine/ai-budget —迁自
 * /admin/settings/ai-budget，owner 2026-10-31：贴着审核引擎Provider域更顺手；
 * 后端settings命名空间API不变).
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

/** 今日用量环图（owner 2026-10-31三轮，参考图：粗描边进度环+中心
 * "已用 / 总量"）。数据=S008参考计价日汇总（纳单位→主币单位）对
 * 单日预算（最小货币单位→主币单位）；无匹配币种汇总=诚实按0计。 */
function BudgetUsageRing({
  usedMajor,
  budgetMajor,
  currency,
}: {
  usedMajor: number;
  budgetMajor: number;
  currency: string;
}) {
  const { t } = useTranslation();
  const budget = Math.max(budgetMajor, 0);
  const used = Math.max(usedMajor, 0);
  const pct = budget > 0 ? used / budget : 0;
  const chartConfig = { used: { color: "var(--primary)" } } satisfies ChartConfig;
  const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2));
  // recharts v3：环半径是图表级像素数（innerRadius/outerRadius只收number），
  // 固定220px方形容器保证环/描边宽度稳定（描边≈outer−inner=26px）。
  // ChartContainer默认aspect-video（16:9）会把svg撑成长方形（中心叠字上移、
  // 说明文字被盖）。工具类互搏不可靠（twMerge不认v4尾部!后缀、样式表顺序
  // 不可控，owner四轮两度复现288px高）——内联样式优先级必胜，直接钉死
  // 220×220；initialDimension同值避免首测闪变。
  return (
    <div className="flex flex-col items-center gap-3" data-testid="ai-budget-usage-ring">
      <div className="relative size-[220px]">
        <ChartContainer
          config={chartConfig}
          className="size-[220px]"
          style={{ width: 220, height: 220, aspectRatio: "auto" }}
          initialDimension={{ width: 220, height: 220 }}
        >
          <RadialBarChart
            data={[{ used: budget > 0 ? Math.min(used, budget) : 0 }]}
            startAngle={90}
            endAngle={-270}
            innerRadius={84}
            outerRadius={110}
          >
            <PolarAngleAxis
              type="number"
              domain={[0, budget > 0 ? budget : 1]}
              tick={false}
              axisLine={false}
            />
            <RadialBar
              dataKey="used"
              background={{ className: "fill-muted" }}
              cornerRadius={13}
              className="fill-primary"
            />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {fmt(used)} / {fmt(budget)}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("admin.aiBudget.usageLabel", { currency })} · {(pct * 100).toFixed(0)}%
          </p>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{t("admin.aiBudget.usageHint")}</p>
    </div>
  );
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
  // 今日参考用量（S008汇总）；币种与预算一致才可计，未匹配=0。
  // reference_amount是币种主单位定点十进制串（不与daily_budget_minor的
  // minor口径混算：环图按主单位显示，预算侧另行/100换算）。
  const usageQuery = useAiUsageSummaryToday(true);
  const usageRow = usageQuery.data?.find((row) => row.currency === form.currency) ?? null;
  const usedMajor =
    usageRow !== null && usageRow.reference_amount !== "" ? Number(usageRow.reference_amount) : 0;

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
    <div className="flex flex-col gap-4">
      <Alert data-testid="ai-budget-r008-note">
        <ShieldAlert />
        <AlertTitle>{t("admin.aiBudget.r008Title")}</AlertTitle>
        <AlertDescription>{t("admin.aiBudget.r008Body")}</AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex items-center gap-2 md:col-span-2">
          <Checkbox
            id="ai-budget-enforced"
            checked={form.enforced}
            onCheckedChange={(checked) => { setForm({ ...form, enforced: checked }); }}
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-budget-input-price">{t("admin.aiBudget.inputPrice")}</Label>
            <Input
              id="ai-budget-input-price"
              type="number"
              min={0}
              value={form.input_price_per_million_minor}
              onChange={(event) => { setForm({ ...form, input_price_per_million_minor: Number(event.target.value) }); }}
              data-testid="ai-budget-input-price"
            />
            <p className="text-muted-foreground text-xs">{t("admin.aiBudget.inputPriceHint")}</p>
          </div>
          <div className="flex flex-col gap-2">
          <Label htmlFor="ai-budget-output-price">{t("admin.aiBudget.outputPrice")}</Label>
          <Input
            id="ai-budget-output-price"
            type="number"
            min={0}
            value={form.output_price_per_million_minor}
            onChange={(event) => { setForm({ ...form, output_price_per_million_minor: Number(event.target.value) }); }}
            data-testid="ai-budget-output-price"
          />
          <p className="text-muted-foreground text-xs">{t("admin.aiBudget.outputPriceHint")}</p>
        </div>

          <p className="text-muted-foreground text-xs">{t("admin.aiBudget.alertHint")}</p>
        </div>

        {/* 参考图1红框位：右列下方三行的用量环图（owner 2026-10-31三轮）。 */}
        <div className="flex items-center justify-center md:col-start-2 md:row-start-3 md:row-span-3">
          <BudgetUsageRing
            usedMajor={usedMajor}
            budgetMajor={form.daily_budget_minor / 100}
            currency={form.currency}
          />
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
        <div className="flex flex-wrap items-center gap-2">
          <PendingButton
            onClick={assess}
            pending={assessMutation.isPending}
            disabled={!dirty}
            data-testid="ai-budget-assess"
          >
            {t("admin.aiBudget.assess")}
          </PendingButton>
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
              <div className="flex flex-wrap gap-2">
                <PendingButton
                  onClick={() => {
                    void onSave(form, assessment.impact_token).then((ok) => {
                      if (!ok) setAssessment(null);
                    });
                  }}
                  pending={saving}
                  data-testid="ai-budget-confirm"
                >
                  {t("admin.aiBudget.confirmSave")}
                </PendingButton>
                <Button variant="outline" onClick={() => { setAssessment(null); }}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <PendingButton
                onClick={() => { void onSave(form, null); }}
                pending={saving}
                data-testid="ai-budget-save-low"
              >
                {t("common.save")}
              </PendingButton>
              <Button variant="outline" onClick={() => { setAssessment(null); }}>
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminAiBudgetPage() {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const namespace = "ai-budget" as const;
  const query = useSettingsNamespace(namespace, enabled);
  // §18.82：修订历史走后端游标分页（默认20行/页）。
  const revisionsPager = useCursorPage(20);
  const revisionsQuery = useSettingsRevisions(namespace, enabled, {
    limit: revisionsPager.pageSize,
    after: revisionsPager.after,
  });
  // §18.82：先于穷尽三元捕获，避免收窄泄漏进分页守卫。
  const revisionsLoaded = !revisionsQuery.isPending && !revisionsQuery.isError;

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
    <PageLayout data-testid="admin-settings-ai-budget">
      <PageHeader
        title={t("admin.aiBudget.title")}
        description={t("admin.aiBudget.description")}
        icon={CircleDollarSign}
        actions={
          query.data !== undefined ? (
            <Badge variant="outline" data-testid="ai-budget-version">
              {t("admin.aiBudget.version", { version: query.data.version })}
            </Badge>
          ) : undefined
        }
      />
      {/* 与设置族四命名空间页同一动效（owner ruling 2026-10-31二轮：六个
          设置tab切换一致）——AnimatePresence fade/rise，含exit。 */}
      <AnimatePresence mode="wait">
        <motion.div
          key="ai-budget"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex flex-col gap-5"
        >
      <Card>
        {query.isPending ? (
          <CardContent>
            <LoadingState variant="panel" />
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
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" /> {t("admin.aiBudget.revisionsTitle")}
          </CardTitle>
          <CardDescription>{t("admin.aiBudget.revisionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="px-0!">
          {revisionsQuery.isPending ? (
            <LoadingState variant="table" columns={4} />
          ) : revisionsQuery.isError ? (
            <ErrorState
              error={revisionsQuery.error}
              operationId="listSettingsRevisions"
              onRetry={() => void revisionsQuery.refetch()}
            />
          ) : revisionsQuery.data.items.length === 0 ? (
            <EmptyState title={t("admin.aiBudget.revisionsEmpty")} />
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
              <TableBody stale={revisionsQuery.isFetching && revisionsQuery.isPlaceholderData}>
                {revisionsQuery.data.items.map((revision) => (
                  <TableRow key={revision.version} data-testid={`ai-budget-revision-${String(revision.version)}`}>
                    <TableCell className="font-semibold tabular-nums text-foreground">v{revision.version}</TableCell>
                    <TableCell className="font-mono">{revision.changed_by}</TableCell>
                    <TableCell>{revision.changed_at}</TableCell>
                    <TableCell className="max-w-72 truncate font-mono">{revision.changed_paths.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {revisionsLoaded ? (
            <TablePagination
              busy={revisionsQuery.isFetching && revisionsQuery.isPlaceholderData}
              page={revisionsPager.pageNo}
              hasMore={revisionsQuery.data.page.has_more}
              isFirst={revisionsPager.isFirst}
              onPrev={revisionsPager.goPrev}
          onJumpPage={revisionsPager.goToPage}
              onNext={() => { revisionsPager.pushCursor(revisionsQuery.data.page.next_cursor); }}
              pageSize={revisionsPager.pageSize}
              onPageSizeChange={revisionsPager.setPageSize}
              rowsOnPage={revisionsQuery.data.items.length}
              testIdPrefix="ai-budget-revisions"
            />
          ) : null}
        </CardContent>
      </Card>
      </motion.div>
      </AnimatePresence>
    </PageLayout>
  );
}

