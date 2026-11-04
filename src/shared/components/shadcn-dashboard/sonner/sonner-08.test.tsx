import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SonnerDemo from "./sonner-08";

/**
 * Smoke test for the vendored sonner-08 block: the demo mounts and its local
 * toast manager actually surfaces toasts through the vendored ui/toast
 * primitives + PositionedToaster (owner ruling 2026-11-04 工单状态使用
 * Sonner 08 组件表示 — the block must be functional, not decorative).
 */
describe("sonner-08 block", () => {
  it("fires a tone toast through the positioned toaster", async () => {
    const user = userEvent.setup();
    render(<SonnerDemo />);
    await user.click(screen.getByRole("button", { name: "Success" }));
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(screen.getByText("Your profile is up to date.")).toBeInTheDocument();
  });

  it("shows the close button only for toasts that opt in", async () => {
    const user = userEvent.setup();
    render(<SonnerDemo />);
    await user.click(screen.getByRole("button", { name: "With close button" }));
    expect(await screen.findByText("Session expires soon")).toBeInTheDocument();
    const close = document.querySelectorAll('[data-slot="toast-close"]');
    expect(close).toHaveLength(1);
  });
});
