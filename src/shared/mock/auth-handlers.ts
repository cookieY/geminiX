import { HttpResponse, http } from "msw";
import type { DefaultBodyType, HttpHandler } from "msw";
import { readStoredAuthBehavior } from "@/shared/mock/auth-scenario-store";
import { currentIdentity } from "@/shared/mock/identity-store";

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

const NOW = "2026-08-28T08:00:00Z";

// 与契约ChangeMyPasswordRequest.new_password的minLength一致。
const MIN_NEW_PASSWORD_LENGTH = 12;

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
  // Identity dimension (§18.44): /users/me answers with the stored mock
  // identity — henry by default; e2e and manual testing flip it to act as
  // the frozen reviewer or the executor without a second login.
  const identity = currentIdentity();
  return {
    id: identity.id,
    username: identity.username,
    email: null,
    is_builtin_admin: canAccessAdmin,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    can_access_admin: canAccessAdmin,
    // §18.52: all mock identities are local accounts; the ldap/oidc branch of
    // the profile security tab is covered by tests overriding /users/me.
    auth_provider: "local",
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

    // §18.52 自助改密。Demo语义：mock没有真实密码存储（登录接受任意凭据，
    // 由auth-behavior维度控制），故只按契约做入参校验——old_password非空、
    // new_password≥12否则1001；成功时清空会话Cookie，镜像后端
    // “改密后全部会话失效、客户端回登录页”的语义。真实旧密码校验/1109
    // 由后端契约测试覆盖。
    http.post("*/users/me/password", async ({ request, cookies }) => {
      const behavior = readStoredAuthBehavior();
      if (behavior === "expired" || !hasSession(cookies)) {
        return unauthenticated();
      }
      const body = (await request.json().catch(() => null)) as
        | { old_password?: unknown; new_password?: unknown }
        | null;
      if (
        body === null ||
        typeof body.old_password !== "string" ||
        body.old_password === "" ||
        typeof body.new_password !== "string" ||
        body.new_password.length < MIN_NEW_PASSWORD_LENGTH
      ) {
        return HttpResponse.json(businessError(1001, "validation failed"));
      }
      return HttpResponse.json(successEnvelope(null), { headers: clearedSessionCookieHeaders() });
    }),

    http.get("*/auth/providers", () =>
      HttpResponse.json(
        successEnvelope({
          local: true,
          ldap: true,
          oidc: [
            {
              key: "corp-oidc",
              label: "企业 OIDC",
              start_url: "/mock/oidc/corp-oidc/start",
            },
          ],
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
