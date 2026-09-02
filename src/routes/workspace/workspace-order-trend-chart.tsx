import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/components/ui/chart";
import type { DailyMetricPoint } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * 工单趋势 line chart (dashboard PRD §3 工单数量与趋势; owner
 * layout-alignment ruling 2026-09-02 against the frozen reference image).
 * Lives in its own module so recharts stays out of the initial bundle —
 * only admin sessions resolve this chunk (check-bundle-budget FORBIDDEN_INITIAL
 * + performance.spec chunk isolation). Animation is off: screenshot baselines
 * are byte-compared and recharts rAF frames would churn them.
 */
export default function WorkspaceOrderTrendChart({ points }: { points: DailyMetricPoint[] }) {
  const { t } = useTranslation();
  const config = {
    // Owner ruling 2026-09-02: the trend line reads white like the reference
    // image — --primary is the near-white foreground of the dark theme and
    // its readable counterpart in the light theme.
    value: { label: t("dashboard.admin.orderTrend"), color: "var(--primary)" },
  } satisfies ChartConfig;
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <div
      role="img"
      aria-label={t("dashboard.admin.trendAria", { total, days: points.length })}
      data-testid="workspace-order-trend-chart"
    >
      <ChartContainer config={config} className="h-[240px] w-full">
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={40}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickFormatter={(day: string) => day.slice(5)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={44}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }}
            content={<ChartTooltipContent />}
          />
          <Line
            dataKey="value"
            type="linear"
            stroke="var(--color-value)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
