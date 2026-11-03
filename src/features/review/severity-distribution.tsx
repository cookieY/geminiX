import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps } from "recharts";
import { useTranslation } from "react-i18next";
import type { ReviewFinding } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/shared/components/ui/chart";

/**
 * Severity distribution of a finding set, built on the Shadcn Dashboard
 * `bar-chart-07` block: recharts BarChart inside the shared ChartContainer,
 * horizontal grid only, ticks without axis lines, a tooltip per bar and the
 * block's 1px top edge on every bar. One column per severity,
 * most severe first (all five, zero counts included); the fills reuse the
 * app's `--risk-*` tokens (muted for info/low). The caller only mounts it
 * when there are findings to show. The x axis names each severity, so colour
 * only reinforces it, and the wrapper carries a text summary for assistive
 * tech — the finding list below remains the complete table view.
 */
const SEVERITIES: { severity: ReviewFinding["severity"]; fill: string }[] = [
  { severity: "critical", fill: "var(--risk-critical)" },
  { severity: "high", fill: "var(--risk-high)" },
  { severity: "medium", fill: "var(--risk-warning)" },
  { severity: "low", fill: "color-mix(in oklch, var(--muted-foreground) 60%, transparent)" },
  { severity: "info", fill: "color-mix(in oklch, var(--muted-foreground) 35%, transparent)" },
];

const chartConfig = {
  count: { label: "Count", color: "var(--primary)" },
} satisfies ChartConfig;

/** The block's bar shape: the bar plus a 1px edge on its top. */
function BarWithBorderTop(props: BarShapeProps) {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return null;
  return (
    <g>
      <Rectangle {...props} />
      <line x1={x} y1={y} x2={x + width} y2={y} stroke={fill} strokeWidth={1} />
    </g>
  );
}

export function SeverityDistribution({ findings }: { findings: ReviewFinding[] }) {
  const { t } = useTranslation();
  const data = SEVERITIES.map((row) => ({
    severity: row.severity,
    label: t(`precheck.severity.${row.severity}`),
    count: findings.filter((finding) => finding.severity === row.severity).length,
    fill: row.fill,
  }));

  return (
    <section className="flex flex-col gap-2" data-testid="severity-distribution">
      <h4 className="text-sm font-semibold">{t("orders.detail.severityDistribution")}</h4>
      <div
        role="img"
        aria-label={data.map((row) => `${row.label} ${String(row.count)}`).join(", ")}
        data-testid="severity-chart"
      >
        <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full">
          <BarChart accessibilityLayer data={data} barSize={30}>
            <CartesianGrid vertical={false} />
            {/* All five severities, zeros included, so the shape stays comparable across orders. */}
            <YAxis hide allowDecimals={false} domain={[0, (max: number) => Math.max(max, 1)]} />
            <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            {/* Each data entry carries its own `fill`; recharts hands it to the shape. */}
            <Bar dataKey="count" radius={[0, 0, 0, 0]} shape={BarWithBorderTop} />
          </BarChart>
        </ChartContainer>
      </div>
    </section>
  );
}
