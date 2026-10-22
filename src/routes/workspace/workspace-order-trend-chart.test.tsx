import "@/shared/i18n"
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import WorkspaceOrderTrendChart from "./workspace-order-trend-chart"

/**
 * Gate `FE-F11-DATA-MOTION` ② — "reduced-motion 下图表绘制动画关闭" — needs an
 * assertion that does not depend on a browser screenshot. Recharts' draw
 * animation is driven by rAF, which Playwright cannot fast-forward, so the
 * decision is pinned here at the prop level: the chart wrapper and recharts
 * are replaced by stubs that record what the component asked for.
 */
const captured = vi.hoisted(() => ({
  line: null as Record<string, unknown> | null,
}))

vi.mock("@/shared/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}))

vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: (props: Record<string, unknown>) => {
    captured.line = props
    return null
  },
}))

const POINTS = [
  { day: "2026-10-01", value: 3 },
  { day: "2026-10-02", value: 7 },
]

function stubReducedMotion(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  captured.line = null
})

describe("WorkspaceOrderTrendChart motion", () => {
  it("renders final on the first frame when reduced motion is requested", () => {
    // The shared test setup reports the query as matching, which is also what
    // both screenshot specs emulate.
    render(<WorkspaceOrderTrendChart points={POINTS} />)

    expect(captured.line?.isAnimationActive).toBe(false)
  })

  it("draws with the shared ease-out curve when motion is allowed", () => {
    stubReducedMotion(false)

    render(<WorkspaceOrderTrendChart points={POINTS} />)

    expect(captured.line?.isAnimationActive).toBe(true)
    expect(captured.line?.animationDuration).toBe(200)
    expect(captured.line?.animationEasing).toBe("cubic-bezier(0.23, 1, 0.32, 1)")
  })
})
