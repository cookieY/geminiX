import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Plus } from "lucide-react";
import type { IdentityProvider } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import {
  useCreateIdentityProvider,
  useDeleteIdentityProvider,
  useIdentityProviders,
  useReplaceIdentityProvider,
  useTestIdentityProviderConnection,
} from "@/features/admin/use-admin";

/**
 * 认证Provider管理 (route /admin/identity-providers; migration contract §2
 * maps the legacy LDAP settings block here; PRD F9 item 7 delivered by
 * F10). LDAP is a singleton (create refused while one exists); OIDC is a
 * list. Secrets never回填: the view carries secret_configured only — create
 * requires a secret, replace keeps (omit) / replaces (new value) / clears
 * (null), and OIDC secrets cannot be cleared while the provider is enabled.
 * The OIDC callback address is server-generated and not part of this
 * surface. LDAP transport is ldaps/starttls only — there is no plaintext
 * transport and no skip-verify option in the declared contract.
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

interface LdapDraft {
  provider_key: string;
  display_name: string;
  enabled: boolean;
  host: string;
  port: number;
  transport: "ldaps" | "starttls";
  server_name: string;
  bind_dn: string;
  base_dn: string;
  user_filter: string;
  username_attribute: string;
  display_name_attribute: string;
  email_attribute: string;
  secret: string;
}

interface OidcDraft {
  provider_key: string;
  display_name: string;
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  scopes: string;
  username_claim: string;
  display_name_claim: string;
  email_claim: string;
  secret: string;
}

const EMPTY_LDAP: LdapDraft = {
  provider_key: "ldap",
  display_name: "",
  enabled: false,
  host: "",
  port: 636,
  transport: "ldaps",
  server_name: "",
  bind_dn: "",
  base_dn: "",
  user_filter: "(&(objectClass=organizationalPerson)(uid={username}))",
  username_attribute: "uid",
  display_name_attribute: "cn",
  email_attribute: "mail",
  secret: "",
};

const EMPTY_OIDC: OidcDraft = {
  provider_key: "",
  display_name: "",
  enabled: false,
  issuer_url: "",
  client_id: "",
  scopes: "openid",
  username_claim: "preferred_username",
  display_name_claim: "name",
  email_claim: "email",
  secret: "",
};

function LdapConnectionTest({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const testConnection = useTestIdentityProviderConnection();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-0.5">
      {/* Async connection test (contract §2: "连接测试异步") — the same
          hook the OIDC table rows use. */}
      <Button
        size="sm"
        variant="outline"
        disabled={testConnection.isPending}
        onClick={() => {
          testConnection.mutate(providerId, {
            onSuccess: (task) => {
              setErrorText(null);
              setTaskId(task.id);
            },
            onError: (error) => {
              setErrorText(describeErrorText(describeError(error, "testIdentityProviderConnection")));
            },
          });
        }}
        data-testid={`admin-idp-test-${providerId}`}
      >
        {t("adminIdp.testConnection")}
      </Button>
      {taskId !== null && (
        <span className="text-muted-foreground font-mono text-xs" data-testid={`admin-idp-test-task-${providerId}`}>
          {t("adminIdp.testTask", { id: taskId })}
        </span>
      )}
      {errorText !== null && (
        <span className="text-destructive text-xs" data-testid={`admin-idp-test-error-${providerId}`}>
          {errorText}
        </span>
      )}
    </div>
  );
}

export default function AdminIdentityProvidersPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const providersQuery = useIdentityProviders(isAdmin);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [createKind, setCreateKind] = useState<"ldap" | "oidc" | null>(null);

  const providers = providersQuery.data ?? [];
  const ldap = providers.find((provider) => provider.provider_kind === "ldap") ?? null;
  const oidcProviders = providers.filter((provider) => provider.provider_kind === "oidc");

  return (
    <div className="flex flex-col gap-4" data-testid="admin-idp-page">
      <PageBreadcrumb title={t("adminIdp.title")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminIdp.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("adminIdp.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={ldap !== null} onClick={() => { setCreateKind("ldap"); }} data-testid="admin-idp-create-ldap">
            <Plus />
            {t("adminIdp.createLdap")}
          </Button>
          <Button onClick={() => { setCreateKind("oidc"); }} data-testid="admin-idp-create-oidc">
            <Plus />
            {t("adminIdp.createOidc")}
          </Button>
        </div>
      </header>

      {providersQuery.isPending && <LoadingState />}
      {providersQuery.error !== null && (
        <ErrorState error={providersQuery.error} operationId="listIdentityProviders" onRetry={() => void providersQuery.refetch()} />
      )}

      {!providersQuery.isPending && providersQuery.error === null && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("adminIdp.ldapCard")}</CardTitle>
              <CardDescription>{t("adminIdp.ldapDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {ldap === null ? (
                <p className="text-muted-foreground py-4 text-center text-sm" data-testid="admin-idp-ldap-empty">
                  {t("adminIdp.ldapEmpty")}
                </p>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" data-testid={`admin-idp-row-${ldap.id}`}>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">{ldap.display_name}</span>
                    <span className="text-muted-foreground truncate font-mono text-xs">
                      {`${String((ldap.configuration as unknown as { host?: string }).host)}:${String((ldap.configuration as unknown as { port?: number }).port)} · ${String((ldap.configuration as unknown as { transport?: string }).transport)}`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={ldap.enabled ? "secondary" : "outline"}>
                      {ldap.enabled ? t("adminIdp.enabled") : t("adminIdp.disabled")}
                    </Badge>
                    <Badge variant="outline">{ldap.secret_configured ? t("adminIdp.secretConfigured") : t("adminIdp.secretMissing")}</Badge>
                    <LdapConnectionTest providerId={ldap.id} />
                    <Button size="sm" variant="outline" onClick={() => { setEditing(ldap); }} data-testid={`admin-idp-edit-${ldap.id}`}>
                      {t("common.edit")}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("adminIdp.oidcCard")}</CardTitle>
              <CardDescription>{t("adminIdp.oidcDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {oidcProviders.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm" data-testid="admin-idp-oidc-empty">
                  {t("adminIdp.oidcEmpty")}
                </p>
              ) : (
                <Table data-testid="admin-idp-oidc-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("adminIdp.column.key")}</TableHead>
                      <TableHead>{t("adminIdp.column.issuer")}</TableHead>
                      <TableHead>{t("adminIdp.column.state")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {oidcProviders.map((provider) => (
                      <TableRow key={provider.id} data-testid={`admin-idp-row-${provider.id}`}>
                        <TableCell className="font-mono text-xs">{provider.provider_key}</TableCell>
                        <TableCell className="max-w-72 truncate font-mono text-xs">
                          {(provider.configuration as { issuer_url?: string }).issuer_url ?? ""}
                        </TableCell>
                        <TableCell>
                          <Badge variant={provider.enabled ? "secondary" : "outline"}>
                            {provider.enabled ? t("adminIdp.enabled") : t("adminIdp.disabled")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => { setEditing(provider); }}>
                              {t("common.edit")}
                            </Button>
                            <DeleteProviderButton provider={provider} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ProviderFormDialog
        open={createKind !== null || editing !== null}
        kind={editing?.provider_kind ?? createKind ?? "oidc"}
        editing={editing}
        onClose={() => {
          setEditing(null);
          setCreateKind(null);
        }}
      />
    </div>
  );
}

function DeleteProviderButton({ provider }: { provider: IdentityProvider }) {
  const { t } = useTranslation();
  const deleteProvider = useDeleteIdentityProvider();
  const testConnection = useTestIdentityProviderConnection();
  const [open, setOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [testTaskId, setTestTaskId] = useState<string | null>(null);
  return (
    <>
      {/* Async connection test (contract §2: "连接测试异步"); the returned
          task id is surfaced for the generic task read route. */}
      <Button
        size="sm"
        variant="outline"
        disabled={testConnection.isPending}
        onClick={() => { testConnection.mutate(provider.id, {
            onSuccess: (task) => {
              setErrorText(null);
              setTestTaskId(task.id);
            },
            onError: (error) => { setErrorText(describeErrorText(describeError(error, "testIdentityProviderConnection"))); },
          }); }
        }
        data-testid={`admin-idp-test-${provider.id}`}
      >
        {t("adminIdp.testConnection")}
      </Button>
      <Button size="sm" variant="destructive" disabled={provider.enabled} onClick={() => { setOpen(true); }} data-testid={`admin-idp-delete-${provider.id}`}>
        {t("common.delete")}
      </Button>
      {testTaskId !== null && (
        <span className="text-muted-foreground font-mono text-xs" data-testid={`admin-idp-test-task-${provider.id}`}>
          {t("adminIdp.testTask", { id: testTaskId })}
        </span>
      )}
      {errorText !== null && (
        <span className="text-destructive text-xs" data-testid={`admin-idp-test-error-${provider.id}`}>
          {errorText}
        </span>
      )}
      <Dialog open={open} onOpenChange={(next) => { if (!next) setOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminIdp.delete.title", { key: provider.provider_key })}</DialogTitle>
            <DialogDescription>{t("adminIdp.delete.description")}</DialogDescription>
          </DialogHeader>
          {errorText !== null && (
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteProvider.isPending}
              onClick={() => { deleteProvider.mutate(
                  { providerId: provider.id, version: provider.version },
                  {
                    onSuccess: () => { setOpen(false); },
                    onError: (error) => { setErrorText(describeErrorText(describeError(error, "deleteIdentityProvider"))); },
                  },
                ); }
              }
            >
              {deleteProvider.isPending ? t("common.saving") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProviderFormDialog({
  open,
  kind,
  editing,
  onClose,
}: {
  open: boolean;
  kind: "ldap" | "oidc";
  editing: IdentityProvider | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createProvider = useCreateIdentityProvider();
  const replaceProvider = useReplaceIdentityProvider();
  const [ldapDraft, setLdapDraft] = useState<LdapDraft>(EMPTY_LDAP);
  const [oidcDraft, setOidcDraft] = useState<OidcDraft>(EMPTY_OIDC);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const formKey = editing?.id ?? `create-${kind}`;
  if (open && openFor !== formKey) {
    setOpenFor(formKey);
    setErrorText(null);
    if (editing === null) {
      setLdapDraft(EMPTY_LDAP);
      setOidcDraft(EMPTY_OIDC);
    } else if (editing.provider_kind === "ldap") {
      const configuration = editing.configuration as unknown as Record<string, string | number>;
      setLdapDraft({
        ...EMPTY_LDAP,
        provider_key: editing.provider_key,
        display_name: editing.display_name,
        enabled: editing.enabled,
        host: String(configuration.host ?? ""),
        port: Number(configuration.port ?? 636),
        transport: configuration.transport as "ldaps" | "starttls",
        server_name: String(configuration.server_name ?? ""),
        bind_dn: String(configuration.bind_dn ?? ""),
        base_dn: String(configuration.base_dn ?? ""),
        user_filter: String(configuration.user_filter ?? ""),
        username_attribute: String(configuration.username_attribute ?? ""),
        display_name_attribute: String(configuration.display_name_attribute ?? ""),
        email_attribute: String(configuration.email_attribute ?? ""),
        secret: "",
      });
    } else {
      const configuration = editing.configuration as unknown as Record<string, string | string[]>;
      setOidcDraft({
        ...EMPTY_OIDC,
        provider_key: editing.provider_key,
        display_name: editing.display_name,
        enabled: editing.enabled,
        issuer_url: String(configuration.issuer_url ?? ""),
        client_id: String(configuration.client_id ?? ""),
        scopes: (configuration.scopes as string[] | undefined)?.join(" ") ?? "openid",
        username_claim: String(configuration.username_claim ?? ""),
        display_name_claim: String(configuration.display_name_claim ?? ""),
        email_claim: String(configuration.email_claim ?? ""),
        secret: "",
      });
    }
  }
  if (!open && openFor !== null) setOpenFor(null);

  const submit = async () => {
    setErrorText(null);
    try {
      if (kind === "ldap") {
        const body = {
          provider_key: ldapDraft.provider_key,
          provider_kind: "ldap" as const,
          display_name: ldapDraft.display_name,
          enabled: ldapDraft.enabled,
          configuration: {
            host: ldapDraft.host,
            port: ldapDraft.port,
            transport: ldapDraft.transport,
            server_name: ldapDraft.server_name,
            bind_dn: ldapDraft.bind_dn,
            base_dn: ldapDraft.base_dn,
            user_filter: ldapDraft.user_filter,
            username_attribute: ldapDraft.username_attribute,
            display_name_attribute: ldapDraft.display_name_attribute,
            email_attribute: ldapDraft.email_attribute,
            connect_timeout_ms: 5000,
            bind_timeout_ms: 5000,
            search_timeout_ms: 5000,
          },
          bind_password: ldapDraft.secret === "" && editing !== null ? undefined : { value: ldapDraft.secret },
        };
        if (editing === null) await createProvider.mutateAsync(body);
        else
          await replaceProvider.mutateAsync({
            providerId: editing.id,
            version: editing.version,
            body: {
              provider_kind: "ldap",
              display_name: body.display_name,
              enabled: body.enabled,
              configuration: body.configuration,
              bind_password: body.bind_password,
            },
          });
      } else {
        const body = {
          provider_key: oidcDraft.provider_key,
          provider_kind: "oidc" as const,
          display_name: oidcDraft.display_name,
          enabled: oidcDraft.enabled,
          configuration: {
            issuer_url: oidcDraft.issuer_url,
            client_id: oidcDraft.client_id,
            scopes: oidcDraft.scopes.split(/\s+/).filter((scope) => scope !== ""),
            username_claim: oidcDraft.username_claim,
            display_name_claim: oidcDraft.display_name_claim,
            email_claim: oidcDraft.email_claim,
            connect_timeout_ms: 5000,
            request_timeout_ms: 10000,
          },
        };
        if (editing === null) {
          if (oidcDraft.secret === "") {
            setErrorText(t("adminIdp.formSecretRequired"));
            return;
          }
          await createProvider.mutateAsync({
            provider_key: body.provider_key,
            provider_kind: "oidc",
            display_name: body.display_name,
            enabled: body.enabled,
            configuration: body.configuration,
            client_secret: { value: oidcDraft.secret },
          });
        } else {
          const secretInput = oidcDraft.secret === "" ? undefined : { value: oidcDraft.secret };
          await replaceProvider.mutateAsync({
            providerId: editing.id,
            version: editing.version,
            body: {
              provider_kind: "oidc",
              display_name: body.display_name,
              enabled: body.enabled,
              configuration: body.configuration,
              client_secret: secretInput,
            },
          });
        }
      }
      onClose();
    } catch (error) {
      setErrorText(
        describeErrorText(describeError(error, editing === null ? "createIdentityProvider" : "replaceIdentityProvider")),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {editing === null
              ? kind === "ldap"
                ? t("adminIdp.createLdap")
                : t("adminIdp.createOidc")
              : t("adminIdp.editTitle", { key: editing.provider_key })}
          </DialogTitle>
          <DialogDescription>{t("adminIdp.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {kind === "ldap" ? (
            <>
              <TextField label={t("adminIdp.field.displayName")} value={ldapDraft.display_name} onChange={(value) => { setLdapDraft({ ...ldapDraft, display_name: value }); }} testId="idp-ldap-display-name" />
              <TextField label={t("adminIdp.field.host")} value={ldapDraft.host} onChange={(value) => { setLdapDraft({ ...ldapDraft, host: value }); }} testId="idp-ldap-host" />
              <div className="flex flex-col gap-2">
                <Label htmlFor="idp-ldap-port">{t("adminIdp.field.port")}</Label>
                <Input id="idp-ldap-port" type="number" min={1} max={65535} value={ldapDraft.port} onChange={(event) => { setLdapDraft({ ...ldapDraft, port: Number(event.target.value) }); }} data-testid="idp-ldap-port" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("adminIdp.field.transport")}</Label>
                <select
                  value={ldapDraft.transport}
                  onChange={(event) => { setLdapDraft({ ...ldapDraft, transport: event.target.value as "ldaps" | "starttls" }); }}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  data-testid="idp-ldap-transport"
                >
                  <option value="ldaps">ldaps</option>
                  <option value="starttls">starttls</option>
                </select>
                <p className="text-muted-foreground text-xs">{t("adminIdp.field.transportHint")}</p>
              </div>
              <TextField label={t("adminIdp.field.serverName")} value={ldapDraft.server_name} onChange={(value) => { setLdapDraft({ ...ldapDraft, server_name: value }); }} testId="idp-ldap-server-name" />
              <TextField label={t("adminIdp.field.bindDn")} value={ldapDraft.bind_dn} onChange={(value) => { setLdapDraft({ ...ldapDraft, bind_dn: value }); }} testId="idp-ldap-bind-dn" />
              <TextField label={t("adminIdp.field.baseDn")} value={ldapDraft.base_dn} onChange={(value) => { setLdapDraft({ ...ldapDraft, base_dn: value }); }} testId="idp-ldap-base-dn" />
              <TextField label={t("adminIdp.field.userFilter")} value={ldapDraft.user_filter} onChange={(value) => { setLdapDraft({ ...ldapDraft, user_filter: value }); }} testId="idp-ldap-user-filter" />
              <TextField label={t("adminIdp.field.usernameAttribute")} value={ldapDraft.username_attribute} onChange={(value) => { setLdapDraft({ ...ldapDraft, username_attribute: value }); }} testId="idp-ldap-username-attribute" />
              <TextField label={t("adminIdp.field.displayNameAttribute")} value={ldapDraft.display_name_attribute} onChange={(value) => { setLdapDraft({ ...ldapDraft, display_name_attribute: value }); }} testId="idp-ldap-display-name-attribute" />
              <TextField label={t("adminIdp.field.emailAttribute")} value={ldapDraft.email_attribute} onChange={(value) => { setLdapDraft({ ...ldapDraft, email_attribute: value }); }} testId="idp-ldap-email-attribute" />
            </>
          ) : (
            <>
              <TextField label={t("adminIdp.field.providerKey")} value={oidcDraft.provider_key} onChange={(value) => { setOidcDraft({ ...oidcDraft, provider_key: value }); }} testId="idp-oidc-key" disabled={editing !== null} />
              <TextField label={t("adminIdp.field.displayName")} value={oidcDraft.display_name} onChange={(value) => { setOidcDraft({ ...oidcDraft, display_name: value }); }} testId="idp-oidc-display-name" />
              <TextField label={t("adminIdp.field.issuerUrl")} value={oidcDraft.issuer_url} onChange={(value) => { setOidcDraft({ ...oidcDraft, issuer_url: value }); }} testId="idp-oidc-issuer" />
              <TextField label={t("adminIdp.field.clientId")} value={oidcDraft.client_id} onChange={(value) => { setOidcDraft({ ...oidcDraft, client_id: value }); }} testId="idp-oidc-client-id" />
              <TextField label={t("adminIdp.field.scopes")} value={oidcDraft.scopes} onChange={(value) => { setOidcDraft({ ...oidcDraft, scopes: value }); }} testId="idp-oidc-scopes" />
              <TextField label={t("adminIdp.field.usernameClaim")} value={oidcDraft.username_claim} onChange={(value) => { setOidcDraft({ ...oidcDraft, username_claim: value }); }} testId="idp-oidc-username-claim" />
              <TextField label={t("adminIdp.field.displayNameClaim")} value={oidcDraft.display_name_claim} onChange={(value) => { setOidcDraft({ ...oidcDraft, display_name_claim: value }); }} testId="idp-oidc-display-name-claim" />
              <TextField label={t("adminIdp.field.emailClaim")} value={oidcDraft.email_claim} onChange={(value) => { setOidcDraft({ ...oidcDraft, email_claim: value }); }} testId="idp-oidc-email-claim" />
              <p className="text-muted-foreground text-xs">{t("adminIdp.field.callbackNote")}</p>
            </>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={kind === "ldap" ? ldapDraft.enabled : oidcDraft.enabled}
              onChange={(event) => {
                if (kind === "ldap") setLdapDraft({ ...ldapDraft, enabled: event.target.checked });
                else setOidcDraft({ ...oidcDraft, enabled: event.target.checked });
              }
              }
              data-testid="idp-enabled"
            />
            {t("adminIdp.field.enabled")}
          </label>

          <div className="flex flex-col gap-2">
            <Label htmlFor="idp-secret">{t("adminIdp.field.secret")}</Label>
            <Input
              id="idp-secret"
              type="password"
              value={kind === "ldap" ? ldapDraft.secret : oidcDraft.secret}
              onChange={(event) => {
                if (kind === "ldap") setLdapDraft({ ...ldapDraft, secret: event.target.value });
                else setOidcDraft({ ...oidcDraft, secret: event.target.value });
              }
              }
              data-testid="idp-secret"
            />
            <p className="text-muted-foreground text-xs">
              {editing === null
                ? t("adminIdp.field.secretCreateHint")
                : t("adminIdp.field.secretEditHint")}
            </p>
          </div>

          {errorText !== null && (
            <Alert variant="destructive" data-testid="idp-form-error">
              <AlertTitle>{t("adminIdp.formFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={
              createProvider.isPending ||
              replaceProvider.isPending ||
              (editing === null && (kind === "ldap" ? ldapDraft.secret : oidcDraft.secret) === "")
            }
            onClick={() => void submit()}
            data-testid="idp-form-submit"
          >
            {createProvider.isPending || replaceProvider.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  label,
  value,
  onChange,
  testId,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={testId}>{label}</Label>
      <Input id={testId} value={value} onChange={(event) => { onChange(event.target.value); }} data-testid={testId} disabled={disabled} />
    </div>
  );
}
