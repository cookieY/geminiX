import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { SeverityDistribution } from "./severity-distribution";

const finding = (severity: ReviewFinding["severity"], id: string): ReviewFinding =>
  ({ id, severity }) as unknown as ReviewFinding;

describe("SeverityDistribution", () => {
  it("charts all five severities, most severe first, with exact counts", () => {
    render(
      <SeverityDistribution
        findings={[finding("low", "a"), finding("critical", "b"), finding("low", "c"), finding("low", "d")]}
      />,
    );
    const rows = (screen.getByTestId("severity-chart").getAttribute("aria-label") ?? "").split(", ");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatch(/critical.*1/);
    expect(rows[1]).toMatch(/high.*0/);
    expect(rows[2]).toMatch(/medium.*0/);
    expect(rows[3]).toMatch(/low.*3/);
    expect(rows[4]).toMatch(/info.*0/);
  });
});
