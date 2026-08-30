import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "@/test/msw/server";
import "@/shared/i18n";
import { SessionProvider } from "@/features/auth/session-provider";
import LoginPage from "./login-page";

/**
 * The login screen is contract-driven: visible methods follow
 * GET /auth/providers, business failures map through the generated error
 * profile, and the admin lock-out shows the server-side reset command.
 */

const UUID = "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac";

function envelope(data: unknown) {
  return { err_code: 0, message: "ok", data, request_id: UUID };
}

function businessError(errCode: number, message: string) {
  return HttpResponse.json({
    err_code: errCode,
    message,
    data: null,
    request_id: UUID,
    retryable: false,
  });
}

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SessionProvider>
          <LoginPage />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.resetHandlers();
});

describe("LoginPage", () => {
  it("renders the local form for the default provider set", async () => {
    renderLogin();
    expect(await screen.findByLabelText("用户名")).toBeVisible();
    expect(screen.getByLabelText("密码")).toBeVisible();
    // ldap=false and oidc=[] in the default mock: no LDAP toggle, no OIDC.
    expect(screen.queryByText("LDAP")).not.toBeInTheDocument();
    expect(screen.queryByText(/使用 .* 登录/)).not.toBeInTheDocument();
  });

  it("shows a mapped INVALID_CREDENTIALS message, never the raw error name", async () => {
    server.use(http.post("*/auth/login", () => businessError(1101, "invalid credentials")));
    renderLogin();
    await userEvent.type(await screen.findByLabelText("用户名"), "henry");
    await userEvent.type(screen.getByLabelText("密码"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("用户名或密码不正确。", {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText(/请求标识/)).toBeVisible();
  });

  it("shows the server reset command when the admin account is locked", async () => {
    server.use(
      http.post("*/auth/login", () =>
        businessError(1102, "admin locked; run ./Yearning --reset-admin-password"),
      ),
    );
    renderLogin();
    await userEvent.type(await screen.findByLabelText("用户名"), "admin");
    await userEvent.type(screen.getByLabelText("密码"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("超级管理员已锁定", {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText("./Yearning --reset-admin-password")).toBeVisible();
  });

  it("sends the safe generic error for an err_code outside the login profile", async () => {
    // 4001 QUERY_GRANT_REQUIRED is real but never declared for login.
    server.use(http.post("*/auth/login", () => businessError(4001, "grant required")));
    renderLogin();
    await userEvent.type(await screen.findByLabelText("用户名"), "henry");
    await userEvent.type(screen.getByLabelText("密码"), "fixture-pw");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText(/超出接口声明的错误范围/, {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText(/请求标识/)).toBeVisible();
  });

  it("submits via the LDAP endpoint on an LDAP-only deployment without a switcher", async () => {
    server.use(
      http.get("*/auth/providers", () =>
        HttpResponse.json(envelope({ local: false, ldap: true, oidc: [] })),
      ),
    );
    let localHits = 0;
    let ldapCredentials: unknown = null;
    server.use(
      http.post("*/auth/login", () => {
        localHits += 1;
        return HttpResponse.json(envelope(null));
      }),
      http.post("*/auth/ldap/login", async ({ request }) => {
        ldapCredentials = (await request.json()) as unknown;
        return HttpResponse.json(envelope(null));
      }),
    );
    renderLogin();
    await userEvent.type(await screen.findByLabelText("用户名", {}, { timeout: 3000 }), "henry");
    await userEvent.type(screen.getByLabelText("密码"), "fixture-pw");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => {
      expect(ldapCredentials).not.toBeNull();
    });
    expect(localHits).toBe(0);
    expect(ldapCredentials).toEqual({ username: "henry", password: "fixture-pw" });
  });

  it("offers and submits the LDAP mode when the server enables it", async () => {
    server.use(
      http.get("*/auth/providers", () =>
        HttpResponse.json(envelope({ local: true, ldap: true, oidc: [] })),
      ),
    );
    let ldapCredentials: unknown = null;
    server.use(
      http.post("*/auth/ldap/login", async ({ request }) => {
        ldapCredentials = (await request.json()) as unknown;
        return HttpResponse.json(envelope(null));
      }),
    );
    renderLogin();
    await userEvent.click(await screen.findByRole("button", { name: "LDAP" }));
    await userEvent.type(screen.getByLabelText("用户名"), "henry");
    await userEvent.type(screen.getByLabelText("密码"), "fixture-pw");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => {
      expect(ldapCredentials).not.toBeNull();
    });
    expect(ldapCredentials).toEqual({ username: "henry", password: "fixture-pw" });
  });

  it("hides the credential form on an OIDC-only deployment", async () => {
    server.use(
      http.get("*/auth/providers", () =>
        HttpResponse.json(
          envelope({
            local: false,
            ldap: false,
            oidc: [{ key: "corp", label: "Corp SSO", start_url: "/oidc/start" }],
          }),
        ),
      ),
    );
    renderLogin();
    expect(
      await screen.findByRole("link", { name: "使用 Corp SSO 登录" }, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
  });

  it("explains itself when the server offers no login method", async () => {
    server.use(
      http.get("*/auth/providers", () =>
        HttpResponse.json(envelope({ local: false, ldap: false, oidc: [] })),
      ),
    );
    renderLogin();
    expect(await screen.findByText("登录方式不可用", {}, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
  });

  it("filters OIDC providers whose start_url is not an http(s) target", async () => {
    server.use(
      http.get("*/auth/providers", () =>
        HttpResponse.json(
          envelope({
            local: true,
            ldap: false,
            oidc: [{ key: "evil", label: "Evil", start_url: "javascript:alert(1)" }],
          }),
        ),
      ),
    );
    renderLogin();
    await screen.findByLabelText("用户名");
    expect(screen.queryByRole("link", { name: /Evil/ })).not.toBeInTheDocument();
  });

  it("shows a retryable error state when the provider list fails", async () => {
    server.use(
      http.get(
        "*/auth/providers",
        () =>
          HttpResponse.json(
            {
              type: "about:blank",
              title: "internal_error",
              status: 500,
              detail: "boom",
              request_id: UUID,
            },
            { status: 500, headers: { "Content-Type": "application/problem+json" } },
          ),
      ),
    );
    renderLogin();
    expect(await screen.findByText("服务暂时不可用，请稍后重试。", {}, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText(/请求标识/)).toBeVisible();
  });

  it("lists OIDC providers returned by the server", async () => {
    server.use(
      http.get("*/auth/providers", () =>
        HttpResponse.json(
          envelope({
            local: true,
            ldap: false,
            oidc: [{ key: "corp", label: "Corp SSO", start_url: "/api/v4/auth/oidc/corp/start" }],
          }),
        ),
      ),
    );
    renderLogin();
    const link = await screen.findByRole("link", { name: "使用 Corp SSO 登录" }, { timeout: 3000 });
    expect(link).toHaveAttribute("href", "/api/v4/auth/oidc/corp/start");
  });

  it("submits credentials to the login operation and succeeds", async () => {
    let received: unknown = null;
    server.use(
      http.post("*/auth/login", async ({ request }) => {
        received = (await request.json()) as unknown;
        return HttpResponse.json(envelope(null), {
          headers: new Headers({
            "Set-Cookie": "yearning_session=e2e; Path=/; HttpOnly; SameSite=Lax",
          }),
        });
      }),
    );
    renderLogin();
    await userEvent.type(await screen.findByLabelText("用户名"), "henry");
    await userEvent.type(screen.getByLabelText("密码"), "fixture-pw");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => {
      expect(received).not.toBeNull();
    });
    expect(received).toEqual({ username: "henry", password: "fixture-pw" });
  });
});
