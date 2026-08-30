import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { authMockHandlers } from "@/shared/mock/auth-handlers";
import { setMockAuthBehavior } from "@/shared/mock/auth-scenario-store";

/**
 * The auth mock layer must speak the same contract as the real backend:
 * business envelopes over HTTP 200, Problem Details on the 401 path, and
 * session issuance exclusively through Set-Cookie headers — never through a
 * URL or web storage.
 */

const server = setupServer(...authMockHandlers());

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  setMockAuthBehavior("default");
});

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("authMockHandlers", () => {
  it("issues session and CSRF cookies on a successful login", async () => {
    const response = await post("https://yearning.test/api/v4/auth/login", {
      username: "henry",
      password: "fixture-pw",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { err_code: number; data: null };
    expect(body.err_code).toBe(0);
    const cookies = response.headers.getSetCookie();
    const joined = cookies.join("; ");
    expect(cookies).toHaveLength(2);
    expect(joined).toContain("yearning_session=");
    expect(joined).toContain("HttpOnly");
    expect(joined).toContain("yearning_csrf=");
  });

  it("answers 1101 for invalid credentials under the matching behavior", async () => {
    setMockAuthBehavior("invalid_credentials");
    const response = await post("https://yearning.test/api/v4/auth/login", {
      username: "henry",
      password: "wrong",
    });
    const body = (await response.json()) as { err_code: number };
    expect(body.err_code).toBe(1101);
  });

  it("answers 1102 with the reset-command message for the locked admin", async () => {
    setMockAuthBehavior("admin_locked");
    const response = await post("https://yearning.test/api/v4/auth/login", {
      username: "admin",
      password: "wrong",
    });
    const body = (await response.json()) as { err_code: number; message: string };
    expect(body.err_code).toBe(1102);
    expect(body.message).toContain("--reset-admin-password");
  });

  it("answers 1001 for a body without a username", async () => {
    const response = await post("https://yearning.test/api/v4/auth/login", { password: "x" });
    const body = (await response.json()) as { err_code: number };
    expect(body.err_code).toBe(1001);
  });

  it("returns the current user only while the session cookie is present", async () => {
    // Node's fetch keeps a cookie jar, so the anonymous leg is observed after
    // a real logout cleared the jar — the same way a browser behaves.
    await post("https://yearning.test/api/v4/auth/login", {
      username: "henry",
      password: "fixture-pw",
    });
    const withCookie = await fetch("https://yearning.test/api/v4/users/me");
    const okBody = (await withCookie.json()) as { err_code: number; data: { can_access_admin: boolean } };
    expect(okBody.err_code).toBe(0);
    expect(okBody.data.can_access_admin).toBe(false);

    await post("https://yearning.test/api/v4/auth/logout");
    const afterLogout = await fetch("https://yearning.test/api/v4/users/me");
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.headers.get("content-type")).toContain("application/problem+json");
  });

  it("serves the admin capability only under the admin behavior", async () => {
    setMockAuthBehavior("admin");
    const response = await fetch("https://yearning.test/api/v4/users/me", {
      headers: { cookie: "yearning_session=mock-session-token" },
    });
    const body = (await response.json()) as { data: { can_access_admin: boolean } };
    expect(body.data.can_access_admin).toBe(true);
  });

  it("answers 401 on /users/me under the expired behavior even with a cookie", async () => {
    setMockAuthBehavior("expired");
    const response = await fetch("https://yearning.test/api/v4/users/me", {
      headers: { cookie: "yearning_session=mock-session-token" },
    });
    expect(response.status).toBe(401);
  });

  it("clears both cookies on logout", async () => {
    const response = await post("https://yearning.test/api/v4/auth/logout");
    const body = (await response.json()) as { err_code: number };
    expect(body.err_code).toBe(0);
    const cookies = response.headers.getSetCookie().join("; ");
    expect(cookies).toContain("yearning_session=;");
    expect(cookies).toContain("Max-Age=0");
  });

  it("returns empty flow pages so zero-permission users see the waiting state", async () => {
    const response = await fetch(
      "https://yearning.test/api/v4/users/me/flows?flow_type=change_review",
    );
    const body = (await response.json()) as { data: { items: unknown[]; page: { has_more: boolean } } };
    expect(body.data.items).toEqual([]);
    expect(body.data.page.has_more).toBe(false);
  });

  it("authenticates the LDAP endpoint with the same cookie semantics", async () => {
    const response = await post("https://yearning.test/api/v4/auth/ldap/login", {
      username: "henry",
      password: "fixture-pw",
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().join("; ");
    expect(cookies).toContain("yearning_session=");
  });

  it("never emits the local-only 1102 on the LDAP endpoint (undeclared there)", async () => {
    setMockAuthBehavior("admin_locked");
    const response = await post("https://yearning.test/api/v4/auth/ldap/login", {
      username: "henry",
      password: "wrong",
    });
    const body = (await response.json()) as { err_code: number };
    expect(body.err_code).toBe(1101);
  });

  it("maps the invalid_credentials behavior onto the LDAP endpoint as 1101", async () => {
    setMockAuthBehavior("invalid_credentials");
    const response = await post("https://yearning.test/api/v4/auth/ldap/login", {
      username: "henry",
      password: "wrong",
    });
    const body = (await response.json()) as { err_code: number };
    expect(body.err_code).toBe(1101);
  });

  it("answers 1001 for an LDAP body without a username", async () => {
    const response = await post("https://yearning.test/api/v4/auth/ldap/login", {
      password: "x",
    });
    const body = (await response.json()) as { err_code: number };
    expect(body.err_code).toBe(1001);
  });
});
