import { render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/shared/components/ui/table"

import { useFlipReorder } from "./use-flip-reorder"

/** Vertical offset per row key, mutated between renders to fake a reorder. */
let tops: Record<string, number> = {}
type Flight = { cancel: () => void }
const flights: Array<{ cancel: ReturnType<typeof vi.fn> }> = []
const animate = vi.fn<(keyframes: unknown, options: unknown) => Flight>()

beforeEach(() => {
  tops = {}
  flights.length = 0
  animate.mockReset()
  animate.mockImplementation(() => {
    const flight = { cancel: vi.fn() }
    flights.push(flight)
    return flight
  })
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top =
        this.dataset.rowKey === undefined ? 0 : (tops[this.dataset.rowKey] ?? 0)
      return {
        top,
        bottom: top + 32,
        height: 32,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (HTMLElement.prototype as { animate?: unknown }).animate
})

function Harness({ keys }: { keys: string[] }) {
  const ref = useFlipReorder<HTMLDivElement>(keys.join("|"))
  return (
    <div ref={ref}>
      {keys.map((key) => (
        <div key={key} data-row-key={key} />
      ))}
    </div>
  )
}

/** Real table components: proves the ref reaches the rendered <tbody>. */
function TableHarness({ keys }: { keys: string[] }) {
  const ref = useFlipReorder<HTMLTableSectionElement>(`table:${keys.join("|")}`)
  return (
    <Table>
      <TableBody ref={ref}>
        {keys.map((key) => (
          <TableRow key={key} data-row-key={key}>
            <TableCell>{key}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function setMotionPreference(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? matches : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })
  )
}

describe("useFlipReorder", () => {
  it("does not animate the first render, where there is no previous position", () => {
    setMotionPreference(false)
    tops = { a: 0, b: 32 }
    render(<Harness keys={["a", "b"]} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it("animates a row by the distance it moved between renders", () => {
    setMotionPreference(false)
    tops = { a: 0, b: 32, c: 64 }
    const { rerender } = render(<Harness keys={["a", "b", "c"]} />)

    // "a" leaves: c moves up from 64 to 32, b keeps its slot.
    tops = { b: 32, c: 32 }
    rerender(<Harness keys={["b", "c"]} />)

    expect(animate).toHaveBeenCalledTimes(1)
    const [keyframes, options] = animate.mock.calls[0] as [
      Array<{ transform: string }>,
      { duration: number; easing: string },
    ]
    expect(keyframes[0]?.transform).toBe("translateY(32px)")
    expect(options.duration).toBe(200)
    expect(options.easing).toBe("cubic-bezier(0.23, 1, 0.32, 1)")
  })

  it("stays still when the user prefers reduced motion", () => {
    setMotionPreference(true)
    tops = { a: 0, b: 32, c: 64 }
    const { rerender } = render(<Harness keys={["a", "b", "c"]} />)

    tops = { b: 32, c: 32 }
    rerender(<Harness keys={["b", "c"]} />)

    expect(animate).not.toHaveBeenCalled()
  })

  it("ignores movement smaller than a visible nudge", () => {
    setMotionPreference(false)
    tops = { a: 0, b: 32 }
    const { rerender } = render(<Harness keys={["a", "b"]} />)

    // Same slots, one pixel of layout jitter: nothing should move on screen.
    tops = { a: 1, b: 33 }
    rerender(<Harness keys={["b", "a"]} />)

    expect(animate).not.toHaveBeenCalled()
  })

  it("animates rows rendered through the real table components", () => {
    setMotionPreference(false)
    tops = { a: 0, b: 32, c: 64 }
    const { rerender } = render(<TableHarness keys={["a", "b", "c"]} />)

    tops = { b: 32, c: 32 }
    rerender(<TableHarness keys={["b", "c"]} />)

    expect(animate).toHaveBeenCalledTimes(1)
    // The animated element must be the row itself, i.e. the ref was really
    // attached to <tbody> and the selector matched data-row-key.
    expect((animate.mock.contexts[0] as HTMLElement).tagName).toBe("TR")
  })

  it("keeps recording positions while reduced motion is on", () => {
    // Seed with motion on: if the suppressed pass below swallowed the record,
    // the last render would then animate a 32px jump and fail here.
    setMotionPreference(false)
    tops = { a: 0, b: 32 }
    const { rerender } = render(<Harness keys={["a", "b"]} />)

    setMotionPreference(true)
    tops = { b: 0 }
    rerender(<Harness keys={["b"]} />)
    expect(animate).not.toHaveBeenCalled()

    setMotionPreference(false)
    tops = { b: 0, c: 32 }
    rerender(<Harness keys={["b", "c"]} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it("cancels its own in-flight animation before measuring again", () => {
    setMotionPreference(false)
    tops = { a: 0, b: 32 }
    const { rerender } = render(<Harness keys={["a", "b"]} />)

    tops = { b: 0 }
    rerender(<Harness keys={["b"]} />)
    expect(flights).toHaveLength(1)
    expect(flights[0]?.cancel).not.toHaveBeenCalled()

    // A second change inside the window: the stale transform must be undone
    // first, otherwise the row is measured mid-flight.
    tops = { b: 0, c: 32 }
    rerender(<Harness keys={["b", "c"]} />)
    expect(flights[0]?.cancel).toHaveBeenCalledTimes(1)
  })
})
