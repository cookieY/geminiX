import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/components/ui/chart";
import { usePrefersReducedMotion } from "@/shared/lib/use-prefers-reduced-motion";
import type { DailyMetricPoint } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * recharts types `animationEasing` as one of five named curves, but its runtime
 * accepts any `cubic-bezier(...)` (parseCubicBezier in animation/easing). The
 * cast keeps the chart on the shared --ease-out token instead of recharts'
 * own "ease-out" ([0.42, 0, 0.58, 1], which is CSS ease-in-out).
 *
 * If a future recharts stops parsing this string, getBezierCoordinates falls
 * back to linear silently — the test pins the value we pass, not recharts'
 * parsing of it.
 */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)" as NonNullable<
  ComponentProps<typeof Line>["animationEasing"]
>;

/**
 * 工单趋势 line chart (dashboard PRD §3 工单数量与趋势; owner
 * layout-alignment ruling 2026-09-02 against the frozen reference image).
 * Lives in its own module so recharts stays out of the initial bundle: the
 * dashboard lazy-imports it, so both the admin and the zero-permission home
 * (§18.71) resolve this chunk on demand rather than on first paint
 * (check-bundle-budget FORBIDDEN_INITIAL + performance.spec chunk isolation).
 * The line draws in 200ms with the shared ease-out curve unless the user
 * prefers reduced motion, in which case it renders final on the first frame —
 * both screenshot specs emulate reduce, so the baselines stay byte-stable.
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
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      role="img"
      aria-label={t("dashboard.admin.trendAria", { total, days: points.length })}
      data-testid="workspace-order-trend-chart"
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* flex-1 in the card's fill chain: the plot stretches to the card on
          tall windows; min-h keeps the reference compact height when the
          viewport is short (F5 definite-height-chain lesson). */}
      <ChartContainer config={config} className="min-h-[240px] w-full flex-1">
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
            isAnimationActive={!reducedMotion}
            animationDuration={200}
            animationEasing={EASE_OUT}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
