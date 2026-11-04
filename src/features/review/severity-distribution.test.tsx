import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { SeverityDistribution } from "./severity-distribution";

const finding = (severity: ReviewFinding["severity"], id: string): ReviewFinding =>
  ({ id, severity }) as unknown as ReviewFinding;

/** owner page feedback 2026-11-04: 数值型分布 —— 五个级别恒定在列、从重到轻，
 * 每项是圆点 + 标签 + 精确计数（含 0），不再使用图表。 */
describe("SeverityDistribution", () => {
  it("lists all five severities, most severe first, with exact counts", () => {
    render(
      <SeverityDistribution
        findings={[finding("low", "a"), finding("critical", "b"), finding("low", "c"), finding("low", "d")]}
      />,
    );
    const counts = screen.getByTestId("severity-counts");
    const items = counts.querySelectorAll("li");
    expect(items).toHaveLength(5);
    expect(screen.getByTestId("severity-count-critical")).toHaveTextContent("1");
    expect(screen.getByTestId("severity-count-high")).toHaveTextContent("0");
    expect(screen.getByTestId("severity-count-medium")).toHaveTextContent("0");
    expect(screen.getByTestId("severity-count-low")).toHaveTextContent("3");
    expect(screen.getByTestId("severity-count-info")).toHaveTextContent("0");
    // Most severe first.
    expect(items[0]).toContainElement(screen.getByTestId("severity-count-critical"));
    expect(items[4]).toContainElement(screen.getByTestId("severity-count-info"));
  });
});
