import { HttpResponse, http } from "msw";
import type { DefaultBodyType, HttpHandler } from "msw";
import { readStoredAuthBehavior } from "@/shared/mock/auth-scenario-store";

/**
 * Hand-written MSW handlers for the authentication endpoints, layered on the
 * orval base mocks (code-generation-policy mock_layer: vitest and Playwright
 * share these). They implement the same contract as the real backend:
 * HTTP 200 business envelopes for domain outcomes, Problem Details for the
 * 401 transport path, and session issuance through Set-Cookie headers —
 * `yearning_session` HttpOnly + `yearning_csrf` double-submit (ADR-0004).
 * The mock never puts a token in a URL or in web storage.
 */

const MOCK_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_COOKIE = "yearning_session";
const CSRF_COOKIE = "yearning_csrf";
const MOCK_SESSION_TOKEN = "mock-session-token";
const MOCK_CSRF_TOKEN = "mock-csrf-token";

const UUID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";
const NOW = "2026-08-28T08:00:00Z";

function successEnvelope(data: DefaultBodyType) {
  return { err_code: 0, message: "ok", data, request_id: MOCK_REQUEST_ID };
}

function businessError(errCode: number, message: string) {
  return {
    err_code: errCode,
    message,
    data: null,
    request_id: MOCK_REQUEST_ID,
    retryable: false,
  };
}

function problem(status: number, title: string, detail: string): HttpResponse<DefaultBodyType> {
  return HttpResponse.json(
    { type: "about:blank", title, status, detail, request_id: MOCK_REQUEST_ID },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

function sessionCookieHeaders(): Headers {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${MOCK_SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax`,
  );
  headers.append("Set-Cookie", `${CSRF_COOKIE}=${MOCK_CSRF_TOKEN}; Path=/; SameSite=Lax`);
  return headers;
}

function clearedSessionCookieHeaders(): Headers {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  headers.append("Set-Cookie", `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
  return headers;
}

// Reads the parsed request cookies — msw populates these from the Cookie
// header in Node and from the service-worker request in the browser, where
// the raw header is not always observable.
function hasSession(cookies: Record<string, string>): boolean {
  return typeof cookies[SESSION_COOKIE] === "string" && cookies[SESSION_COOKIE] !== "";
}

function mockUser(canAccessAdmin: boolean) {
  return {
    id: UUID,
    username: "henry",
    email: null,
    is_builtin_admin: canAccessAdmin,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    can_access_admin: canAccessAdmin,
  };
}

function userEnvelope(canAccessAdmin: boolean) {
  return HttpResponse.json(successEnvelope(mockUser(canAccessAdmin)));
}

function unauthenticated() {
  return problem(401, "session_expired", "no active session");
}

/** Which login form submissions succeed, and who the session belongs to. */
function loginOutcome(behavior: string): { ok: boolean; canAccessAdmin: boolean } {
  switch (behavior) {
    case "invalid_credentials":
    case "admin_locked":
      return { ok: false, canAccessAdmin: false };
    case "admin":
      return { ok: true, canAccessAdmin: true };
    default:
      return { ok: true, canAccessAdmin: false };
  }
}

function credentialProblem(behavior: string, endpoint: "local" | "ldap"): HttpResponse<DefaultBodyType> | null {
  if (behavior === "invalid_credentials") {
    return HttpResponse.json(businessError(1101, "invalid credentials"));
  }
  if (behavior === "admin_locked") {
    // 1102 ADMIN_PASSWORD_LOCKED is declared only for the local login
    // operation (auth_external_login = [1001, 1101, 1002]); the LDAP endpoint
    // reports the generic credential failure instead of an undeclared code.
    if (endpoint === "ldap") {
      return HttpResponse.json(businessError(1101, "invalid credentials"));
    }
    return HttpResponse.json(
      businessError(1102, "admin locked; run ./Yearning --reset-admin-password"),
    );
  }
  return null;
}

export function authMockHandlers(): HttpHandler[] {
  return [
    http.post("*/auth/login", async ({ request }) => {
      const behavior = readStoredAuthBehavior();
      const failure = credentialProblem(behavior, "local");
      if (failure !== null) return failure;
      const body = (await request.json().catch(() => null)) as { username?: string } | null;
      if (body === null || body.username === undefined || body.username === "") {
        return HttpResponse.json(businessError(1001, "validation failed"));
      }
      const { ok } = loginOutcome(behavior);
      if (!ok) {
        return HttpResponse.json(businessError(1101, "invalid credentials"));
      }
      return HttpResponse.json(successEnvelope(null), { headers: sessionCookieHeaders() });
    }),

    http.post("*/auth/ldap/login", async ({ request }) => {
      const behavior = readStoredAuthBehavior();
      const failure = credentialProblem(behavior, "ldap");
      if (failure !== null) return failure;
      const body = (await request.json().catch(() => null)) as { username?: string } | null;
      if (body === null || body.username === undefined || body.username === "") {
        return HttpResponse.json(businessError(1001, "validation failed"));
      }
      const { ok } = loginOutcome(behavior);
      if (!ok) {
        return HttpResponse.json(businessError(1101, "invalid credentials"));
      }
      return HttpResponse.json(successEnvelope(null), { headers: sessionCookieHeaders() });
    }),

    http.post("*/auth/logout", () =>
      HttpResponse.json(successEnvelope(null), { headers: clearedSessionCookieHeaders() }),
    ),

    http.get("*/auth/providers", () =>
      HttpResponse.json(
        successEnvelope({
          local: true,
          ldap: false,
          oidc: [],
        }),
      ),
    ),

    http.get("*/users/me", ({ cookies }) => {
      const behavior = readStoredAuthBehavior();
      if (behavior === "expired" || !hasSession(cookies)) {
        return unauthenticated();
      }
      return userEnvelope(behavior === "admin");
    }),

    // NOTE: GET /users/me/flows is owned by the stateful review fixture
    // (shared/mock/review-fixture.ts), which derives the zero-permission
    // empty page from the auth behavior so FE-F3's waiting state and FE-F4's
    // granted workspace share one source of truth.
  ];
}
