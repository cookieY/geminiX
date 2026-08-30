import { create } from "zustand";

/**
 * Authentication mock behaviors, layered next to the demo scenario dimension
 * (scenario-store). Handlers read the stored behavior per request so Playwright
 * can flip mid-session (e.g. expiry discovered by a background refetch).
 * The session itself lives in the HttpOnly `yearning_session` cookie set by
 * the mock login response — the browser cookie jar is the only session state,
 * exactly as with the real backend.
 */
export type MockAuthBehavior =
  | "default"
  | "admin"
  | "invalid_credentials"
  | "admin_locked"
  | "expired";

export const MOCK_AUTH_BEHAVIORS: MockAuthBehavior[] = [
  "default",
  "admin",
  "invalid_credentials",
  "admin_locked",
  "expired",
];

const STORAGE_KEY = "yearning-mock-auth";

export function readStoredAuthBehavior(): MockAuthBehavior {
  const value = localStorage.getItem(STORAGE_KEY);
  return MOCK_AUTH_BEHAVIORS.includes(value as MockAuthBehavior)
    ? (value as MockAuthBehavior)
    : "default";
}

export const useMockAuthBehavior = create<{ behavior: MockAuthBehavior }>(() => ({
  behavior: "default",
}));

export function setMockAuthBehavior(behavior: MockAuthBehavior): void {
  localStorage.setItem(STORAGE_KEY, behavior);
  useMockAuthBehavior.setState({ behavior });
  window.dispatchEvent(new CustomEvent("yearning:mock-auth"));
}
