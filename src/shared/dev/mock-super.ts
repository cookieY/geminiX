/**
 * Dev-only mock super session (owner ruling 2026-11-03: mock账号给我全部
 * 权限，不想切换账号来测试). Single source of truth shared by two layers:
 *
 * - the MSW mock layer (identity-store.holdsActorSlot / mockSuperMode) gates
 *   what the fake backend would let the session do;
 * - the app's client-side actor-slot helpers (order-state.ts, order pages)
 *   gate which affordances render — both must agree, otherwise the mock
 *   allows an action the UI never offers.
 *
 * The flag is `yearning-mock-super` in localStorage: "0" restores the strict
 * three-identity world, "1" forces it on. Default is the vite dev server
 * (`MODE === "development"`): vitest runs `MODE=test` (where
 * `import.meta.env.DEV` is still true!) and production/preview builds run
 * `MODE=production`, so tests and screenshot baselines keep the
 * deterministic identity separation. This module is intentionally free of
 * MSW imports so app code can use it without dragging the mock layer into
 * production bundles; in production builds the default evaluates to false.
 */

import { getServerDimensions } from "@/shared/mock/server-dimensions";

export const SUPER_STORAGE_KEY = "yearning-mock-super";

export function mockSuperSession(): boolean {
  // Node transport (vite dev middleware, 2026-11-04): shared server dims.
  // Guard on `window` — Node ≥22 ships a global localStorage, so the
  // typeof-localStorage probe is false-negative in the dev server process.
  if (typeof window === "undefined") return getServerDimensions().superMode;
  const value = localStorage.getItem(SUPER_STORAGE_KEY);
  if (value === "0") return false;
  if (value === "1") return true;
  return import.meta.env.MODE === "development";
}

/**
 * Does the session user hold this frozen actor/owner slot? Super mode answers
 * yes for every slot; otherwise the exact id match applies (§18.44
 * three-identity split).
 */
export function holdsSessionSlot(
  slotUserId: string,
  sessionUserId: string | null | undefined,
): boolean {
  if (slotUserId === sessionUserId) return true;
  return mockSuperSession();
}
