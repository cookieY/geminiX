import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  login,
  loginWithLdap,
  listAuthenticationProviders,
} from "@/api/generated/client/authentication/authentication";
import type { LoginRequest } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { businessErrCodeByName, describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { ShieldAlert } from "lucide-react";
import { BrandLogo } from "@/app/shell/brand-logo";

/**
 * Local / LDAP / OIDC login screen. Visible methods follow the server's
 * enabled-provider list (GET /auth/providers) — the page renders no method
 * the backend does not offer, including the credential form itself for
 * OIDC-only deployments. Credentials go only to the session endpoints; on
 * success the HttpOnly session cookie is set by the server and the session
 * query is invalidated so the route guard proceeds without any client-held
 * token. The unified error mapping keeps undeclared err_code outcomes on the
 * safe generic path; the admin lock-out special copy applies only to the
 * operation profile that actually declares it.
 *
 * The admin lock-out keeps the contract copy: after the fifth failed password
 * the page must show the server-side reset command (auth PRD §6) — there is
 * deliberately no web-based unlock path.
 */

type LoginMode = "local" | "ldap";

const ADMIN_LOCKED_CODE = businessErrCodeByName("ADMIN_PASSWORD_LOCKED");

interface AuthenticationProviders {
  local: boolean;
  ldap: boolean;
  oidc: { key: string; label: string; start_url: string }[];
}

/** Only server-issued http(s) targets may become redirect targets (no javascript: URLs). */
function isSafeStartUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function LoginPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<LoginMode>("local");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const providersQuery = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: async () => {
      // The unified mutator unwraps err_code=0 to the envelope's `data`.
      return (await listAuthenticationProviders()) as unknown as AuthenticationProviders;
    },
    retry: false,
  });

  const providers = providersQuery.data;
  const credentialFormVisible = providers !== undefined && (providers.local || providers.ldap);
  // An LDAP-only deployment (local=false, ldap=true) renders the credential
  // form without a mode switcher; it must talk to the LDAP endpoint even
  // though the default mode state says "local".
  const effectiveMode: LoginMode =
    providers !== undefined && !providers.local && providers.ldap ? "ldap" : mode;

  const loginMutation = useMutation({
    mutationFn: async (request: LoginRequest) => {
      if (effectiveMode === "ldap") {
        await loginWithLdap(request);
      } else {
        await login(request);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending) return;
    loginMutation.mutate({ username, password });
  };

  const switchMode = (next: LoginMode) => {
    setMode(next);
    // A previous failure belongs to the previous method; drop it.
    loginMutation.reset();
  };

  const error = loginMutation.error;
  const operationId = effectiveMode === "ldap" ? "loginWithLdap" : "login";
  const errorDisplay = error == null ? null : describeError(error, operationId);
  const isAdminLocked =
    !errorDisplay?.contractViolation &&
    ADMIN_LOCKED_CODE !== null &&
    error !== null &&
    typeof error === "object" &&
    "err_code" in error &&
    (error as { err_code: unknown }).err_code === ADMIN_LOCKED_CODE;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <BrandLogo />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {providersQuery.isPending && <LoadingState label={t("login.loadingProviders")} />}
          {providersQuery.isError && (
            <ErrorState
              error={providersQuery.error}
              operationId="listAuthenticationProviders"
              onRetry={() => {
                void providersQuery.refetch();
              }}
            />
          )}
          {providers !== undefined && providers.local && providers.ldap && (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("login.methodGroup")}>
              <Button
                type="button"
                variant={mode === "local" ? "default" : "outline"}
                aria-pressed={mode === "local"}
                onClick={() => {
                  switchMode("local");
                }}
              >
                {t("login.modeLocal")}
              </Button>
              <Button
                type="button"
                variant={mode === "ldap" ? "default" : "outline"}
                aria-pressed={mode === "ldap"}
                onClick={() => {
                  switchMode("ldap");
                }}
              >
                {t("login.modeLdap")}
              </Button>
            </div>
          )}
          {credentialFormVisible && (
            <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="username">{t("login.username")}</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                  }}
                  placeholder={t("login.placeholder.username")}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{t("login.password")}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  placeholder={t("login.placeholder.password")}
                  required
                />
              </div>
              {error != null &&
                errorDisplay !== null &&
                (isAdminLocked ? (
                  <Alert variant="destructive">
                    <ShieldAlert />
                    <AlertTitle>{t("login.adminLocked.title")}</AlertTitle>
                    <AlertDescription>
                      {t("login.adminLocked.prompt")}{" "}
                      <code className="font-mono text-xs">./Yearning --reset-admin-password</code>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <ErrorState error={error} operationId={operationId} />
                ))}
              <Button
                type="submit"
                disabled={loginMutation.isPending || username === "" || password === ""}
              >
                {loginMutation.isPending ? t("states.loading") : t("login.submit")}
              </Button>
            </form>
          )}
          {providers !== undefined &&
            providers.oidc
              .filter((provider) => isSafeStartUrl(provider.start_url))
              .map((provider) => (
                <Button
                  key={provider.key}
                  type="button"
                  variant="outline"
                  render={
                    <a href={provider.start_url} className="w-full">
                      {t("login.oidcButton", { label: provider.label })}
                    </a>
                  }
                />
              ))}
          {providers !== undefined && !credentialFormVisible && providers.oidc.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("login.noMethods")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
