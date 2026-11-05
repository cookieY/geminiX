import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/shared/i18n";
import { GlobalSearchBar, filterBySearchTerms, type SearchAccessor, type SearchTerm } from "@/shared/components/global-search-bar";

interface Row {
  number: string;
  title: string;
  state: string;
}

const accessors: SearchAccessor<Row>[] = [
  { key: "number", label: "工单号", value: (row) => row.number },
  { key: "title", label: "标题", value: (row) => row.title },
  {
    key: "state",
    label: "状态",
    value: (row) => `${row.state} ${row.state === "running" ? "执行中" : "已提交"}`,
    options: [{ label: "执行中" }, { label: "已提交" }],
  },
  // Owner feedback 2026-11-05: the bar also owns date filters — the value
  // comes from the inline calendar, never from typed text.
  { key: "from", label: "起始日期", value: () => "", input: "date" },
];

const rows: Row[] = [
  { number: "YR-1", title: "归档字段", state: "running" },
  { number: "YR-2", title: "索引调整", state: "submitted" },
];

describe("filterBySearchTerms", () => {
  it("matches free text against any field, case-insensitively", () => {
    expect(filterBySearchTerms(rows, [{ field: null, text: "yr-1" }], accessors)).toEqual([rows[0]]);
    expect(filterBySearchTerms(rows, [{ field: null, text: "索引" }], accessors)).toEqual([rows[1]]);
  });

  it("scopes a term to one field and ANDs multiple terms", () => {
    expect(filterBySearchTerms(rows, [{ field: "title", text: "YR" }], accessors)).toEqual([]);
    expect(
      filterBySearchTerms(rows, [{ field: "state", text: "执行中" }, { field: "number", text: "yr" }], accessors),
    ).toEqual([rows[0]]);
  });

  it("matches the localized label of an enum field", () => {
    expect(filterBySearchTerms(rows, [{ field: "state", text: "已提交" }], accessors)).toEqual([rows[1]]);
  });

  it("returns every row for empty terms", () => {
    expect(filterBySearchTerms(rows, [{ field: null, text: "  " }], accessors)).toEqual(rows);
  });
});

function renderBar(overrides: Partial<Parameters<typeof GlobalSearchBar>[0]> = {}) {
  const onTermsChange = vi.fn();
  const onLiveChange = vi.fn();
  const base = render(
    <GlobalSearchBar
      fields={accessors}
      terms={[]}
      onTermsChange={onTermsChange}
      onLiveChange={onLiveChange}
      testId="gsb"
      {...overrides}
    />,
  );
  return { ...base, onTermsChange, onLiveChange };
}

/** Terms flow back into the bar the way a real page feeds them. */
function StatefulBar({
  initialTerms,
  resetKey,
  onTermsChange,
  onLiveChange,
}: {
  initialTerms: SearchTerm[];
  resetKey?: number;
  onTermsChange?: (terms: SearchTerm[]) => void;
  onLiveChange?: (live: SearchTerm | null) => void;
}) {
  const [terms, setTerms] = useState(initialTerms);
  return (
    <GlobalSearchBar
      fields={accessors}
      terms={terms}
      onTermsChange={(next) => {
        onTermsChange?.(next);
        setTerms(next);
      }}
      onLiveChange={onLiveChange}
      testId="gsb"
      resetKey={resetKey}
    />
  );
}

describe("GlobalSearchBar", () => {
  it("reports the live text while typing and commits it as a chip on Enter", async () => {
    const user = userEvent.setup();
    const onTermsChange = vi.fn();
    const onLiveChange = vi.fn();
    render(
      <StatefulBar
        initialTerms={[]}
        onTermsChange={onTermsChange}
        onLiveChange={onLiveChange}
      />,
    );
    const input = screen.getByTestId("gsb");
    await user.type(input, "归档");
    expect(onLiveChange).toHaveBeenLastCalledWith({ field: null, text: "归档" });
    await user.type(input, "{Enter}");
    expect(onLiveChange).toHaveBeenLastCalledWith(null);
    expect(onTermsChange).toHaveBeenLastCalledWith([{ field: null, text: "归档" }]);
    expect(input).toHaveValue("");
    expect(screen.getByText("归档")).toBeVisible();
  });

  it("removes a committed chip through its affordance", async () => {
    const user = userEvent.setup();
    render(<StatefulBar initialTerms={[{ field: null, text: "归档" }]} />);
    await user.click(screen.getByRole("button", { name: /移除条件/ }));
    expect(screen.queryByText("归档")).toBeNull();
  });

  it("replaces the previous any-field chip instead of stacking them", async () => {
    const user = userEvent.setup();
    render(
      <StatefulBar initialTerms={[{ field: null, text: "旧词" }, { field: "title", text: "标题词" }]} />,
    );
    await user.type(screen.getByTestId("gsb"), "新词{Enter}");
    expect(screen.getByText("新词")).toBeVisible();
    expect(screen.queryByText("旧词")).toBeNull();
    // The scoped chip survives — only the free-text slot is single.
    expect(screen.getByText("标题: 标题词")).toBeVisible();
  });

  it("re-reports the live draft when a chip is removed (review M2)", async () => {
    const user = userEvent.setup();
    const onLiveChange = vi.fn();
    render(
      <StatefulBar
        initialTerms={[{ field: null, text: "归档" }]}
        onLiveChange={onLiveChange}
      />,
    );
    await user.type(screen.getByTestId("gsb"), "def");
    expect(onLiveChange).toHaveBeenLastCalledWith({ field: null, text: "def" });
    await user.click(screen.getByRole("button", { name: /移除条件/ }));
    expect(screen.queryByText("归档")).toBeNull();
    expect(onLiveChange).toHaveBeenLastCalledWith({ field: null, text: "def" });
    expect(screen.getByTestId("gsb")).toHaveValue("def");
  });

  it("ignores Enter while an IME composition is active (review M3)", async () => {
    const user = userEvent.setup();
    const { onTermsChange } = renderBar();
    const input = screen.getByTestId("gsb");
    await user.type(input, "归");
    const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(composing, "isComposing", { value: true });
    input.dispatchEvent(composing);
    expect(onTermsChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("归");
  });

  it("only commits exact enum labels on a scoped options field (review L5)", async () => {
    const user = userEvent.setup();
    const { onTermsChange } = renderBar();
    await user.click(screen.getByTestId("gsb"));
    await user.click(screen.getByRole("option", { name: "状态" }));
    await user.type(screen.getByTestId("gsb"), "不匹配的值");
    await user.type(screen.getByTestId("gsb"), "{Enter}");
    expect(onTermsChange).not.toHaveBeenCalled();
    expect(screen.getByText("无匹配项")).toBeVisible();
  });

  it("closes the dropdown automatically when an option-less field is selected (owner 2026-11-05)", async () => {
    const user = userEvent.setup();
    renderBar();
    const input = screen.getByTestId("gsb");
    await user.click(input);
    expect(screen.getByRole("listbox")).toBeVisible();
    await user.click(screen.getByRole("option", { name: "标题" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByTestId("gsb-menu")).toBeNull();
    expect(input).toHaveAttribute("placeholder", "输入标题后按回车确认");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  /** The 15th of the current month, as the chip value / calendar text. */
  function currentMonthDay(day: number): { chip: string; label: string } {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const paddedDay = String(day).padStart(2, "0");
    return {
      chip: `${String(now.getFullYear())}-${month}-${paddedDay}`,
      label: `${String(now.getFullYear())}年${String(now.getMonth() + 1)}月${String(day)}日`,
    };
  }

  /** The calendar's day button — scoped to the dialog and matched by its
   * localized aria-label, so no DOM-order assumption is involved. */
  async function clickCalendarDay(user: ReturnType<typeof userEvent.setup>, day: number): Promise<void> {
    const now = new Date();
    const label = new RegExp(
      `^${String(now.getFullYear())}年${String(now.getMonth() + 1)}月${String(day)}日`,
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: label }));
  }

  it("scopes a date field to the inline calendar and commits the picked day (owner 2026-11-05)", async () => {
    const user = userEvent.setup();
    const onTermsChange = vi.fn();
    render(<StatefulBar initialTerms={[]} onTermsChange={onTermsChange} />);
    const input = screen.getByTestId("gsb");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "起始日期" }));
    // The suggestion listbox is replaced by the calendar dialog panel — no
    // hint or no-match copy, and combobox popup attributes wire to the
    // calendar dialog without a dangling activedescendant (review R2 M1).
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("无匹配项")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "起始日期 — 选择日期" });
    expect(dialog).toBeVisible();
    expect(dialog.querySelector('[data-slot="calendar"]')).not.toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-haspopup", "dialog");
    expect(input).toHaveAttribute("aria-controls", dialog.id);
    expect(input).not.toHaveAttribute("aria-activedescendant");

    const picked = currentMonthDay(15);
    await clickCalendarDay(user, 15);
    expect(onTermsChange).toHaveBeenLastCalledWith([{ field: "from", text: picked.chip }]);
    expect(screen.getByText(`起始日期: ${picked.chip}`)).toBeVisible();
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");
  });

  it("never commits typed text for a date field; a second pick replaces the chip", async () => {
    const user = userEvent.setup();
    render(<StatefulBar initialTerms={[]} />);
    const input = screen.getByTestId("gsb");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "起始日期" }));
    await user.type(input, "2026");
    await user.type(input, "{Enter}");
    expect(screen.queryByText(/起始日期:/)).toBeNull();

    await clickCalendarDay(user, 15);
    const first = currentMonthDay(15);
    expect(screen.getByText(`起始日期: ${first.chip}`)).toBeVisible();
    // Picking closed the panel (ECS behavior); re-scoping reopens the
    // calendar with the committed day selected.
    expect(screen.queryAllByTestId("gsb-menu")).toHaveLength(0);
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "起始日期" }));
    await clickCalendarDay(user, 16);
    const second = currentMonthDay(16);
    expect(screen.queryByText(`起始日期: ${first.chip}`)).toBeNull();
    expect(screen.getByText(`起始日期: ${second.chip}`)).toBeVisible();
  });

  it("scopes a field from the suggestion list, picks a translated option, and closes the dropdown", async () => {
    const user = userEvent.setup();
    const { onTermsChange } = renderBar();
    await user.click(screen.getByTestId("gsb"));
    await user.click(screen.getByRole("option", { name: "状态" }));
    expect(screen.getByTestId("gsb")).toHaveAttribute("placeholder", "输入状态的值");
    await user.click(screen.getByRole("option", { name: "执行中" }));
    expect(onTermsChange).toHaveBeenLastCalledWith([{ field: "state", text: "执行中" }]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByTestId("gsb-menu")).toBeNull();
    expect(screen.getByTestId("gsb")).toHaveAttribute("aria-expanded", "false");
  });

  it("typing filters field suggestions and Enter commits the global term", async () => {
    const user = userEvent.setup();
    const { onTermsChange, onLiveChange } = renderBar();
    await user.click(screen.getByTestId("gsb"));
    await user.type(screen.getByTestId("gsb"), "标题");
    expect(screen.getByRole("option", { name: "搜索 “标题”" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "状态" })).toBeNull();
    await user.type(screen.getByTestId("gsb"), "{Enter}");
    expect(onLiveChange).toHaveBeenCalledWith({ field: null, text: "标题" });
    expect(onTermsChange).toHaveBeenLastCalledWith([{ field: null, text: "标题" }]);
  });

  it("Backspace on an empty input removes the last chip and clear-all empties everything", async () => {
    const user = userEvent.setup();
    render(
      <StatefulBar
        initialTerms={[
          { field: null, text: "归档" },
          { field: "state", text: "执行中" },
        ]}
      />,
    );
    await user.type(screen.getByTestId("gsb"), "{Backspace}");
    expect(screen.queryByText("状态: 执行中")).toBeNull();
    expect(screen.getByText("归档")).toBeVisible();
    await user.click(screen.getByTestId("gsb-clear"));
    expect(screen.queryByText("归档")).toBeNull();
  });

  it("a resetKey bump clears the local draft", async () => {
    const user = userEvent.setup();
    const { rerender } = renderBar();
    await user.type(screen.getByTestId("gsb"), "草稿词");
    rerender(
      <GlobalSearchBar
        fields={accessors}
        terms={[]}
        onTermsChange={vi.fn()}
        onLiveChange={vi.fn()}
        testId="gsb"
        resetKey={1}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("gsb")).toHaveValue("");
    });
  });
});
