import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Pencil, PlugZap, Plus, Trash2 } from "lucide-react";
import type {
  CredentialWrite,
  Datasource,
  DatasourceWrite,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useAdminTask,
  useCreateDatasource,
  useDatasourceCapabilities,
  useDatasources,
  useDeleteDatasource,
  useReplaceDatasource,
  useTestDatasourceConnection,
} from "@/features/admin/use-admin";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { TableSearchInput } from "@/shared/components/table-search-input";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { TablePagination } from "@/shared/components/ui/table-pagination";

/**
 * 数据源管理（route /admin/datasources；migration contract §2 maps the
 * legacy /manager/db here with the §3 field reorganization). The form carries
 * Engine/兼容模式/部署类型/版本约束 and the Review/Query/Execution purpose
 * credentials; the legacy flow_id/rule_id/principal/is_query/SSL-file fields
 * are consciously gone. Secrets are write-only: the API never echoes a
 * credential or TLS material, the form never prefills one, and every
 * credential row edits in exactly ONE explicit mode (B13 contract):
 * replace (username + fresh password), reuse (username + another purpose's
 * stored secret) or keep (only offered on a row that already has a stored
 * credential; the payload then carries reuse_credential_purpose equal to the
 * row's own purpose and no username at all).
 *
 * TLS material is the declared DatasourceTLSWrite surface: CA / client cert
 * / client key are write-only PEM textareas, the cert and key must be
 * supplied together, and the block replaces fully — submitting without the
 * block removes every stored material and returns the datasource to
 * plaintext, so keeping verified TLS means re-entering the full material on
 * every save. The list surfaces tls_verified (verified-vs-plaintext) and
 * nothing about the material itself.
 */

const PURPOSES = ["review", "query", "execution"] as const;
type Purpose = (typeof PURPOSES)[number];

/** The three explicit credential edit modes of the B13 contract; "keep" is
 * only legal for a purpose that already has a stored credential. */
type CredentialMode = "replace" | "reuse" | "keep";

const ENGINE_OPTIONS = [
  { value: "mysql", modes: ["mysql"] },
  { value: "postgresql", modes: ["postgresql"] },
  { value: "tidb", modes: ["mysql"] },
  { value: "oceanbase", modes: ["mysql"] },
  { value: "polardb", modes: ["mysql", "postgresql"] },
] as const;

interface PurposeFormState {
  included: boolean;
  mode: CredentialMode;
  username: string;
  password: string;
  /** Source purpose for reuse mode (another purpose with a stored
   * credential; the old row's secret is reused under the new username). */
  reuseSource: Purpose | "";
}

interface TLSFormState {
  /** Checked = submit a DatasourceTLSWrite block; unchecked = submit null
   * (full-replacement semantics: removal + plaintext). */
  enabled: boolean;
  caPem: string;
  clientCertPem: string;
  clientKeyPem: string;
}

/** Credential-class vocabulary of the connection-test purpose (§18.62,
 * aligned with the list's 只读/读写 badge): the select speaks two classes,
 * submit resolves them onto the contract's purpose enum — read-write probes
 * the execution credential, read-only probes review (falling back to query
 * when the payload keeps no review credential). */
type TestCredentialKind = "readonly" | "readwrite";

interface DatasourceFormState {
  name: string;
  engine: string;
  compatibilityMode: string;
  deploymentKind: string;
  host: string;
  port: string;
  databaseName: string;
  versionConstraint: string;
  enabled: boolean;
  /** §18.61：连接测试用途持久化在数据源上——表格「测试连接」按它选择
   * 已存凭据；变更收敛到本表单（全量替换语义，提交即写入）。§18.62：
   * 表单以只读/读写两态呈现，提交时解析为契约枚举。 */
  testKind: TestCredentialKind;
  purposes: Record<Purpose, PurposeFormState>;
  tls: TLSFormState;
}

function freshPurposes(): Record<Purpose, PurposeFormState> {
  return {
    review: { included: true, mode: "replace", username: "", password: "", reuseSource: "" },
    query: { included: false, mode: "replace", username: "", password: "", reuseSource: "" },
    execution: { included: false, mode: "replace", username: "", password: "", reuseSource: "" },
  };
}

function formForCreate(): DatasourceFormState {
  return {
    name: "",
    engine: "mysql",
    compatibilityMode: "mysql",
    deploymentKind: "native",
    host: "",
    port: "3306",
    databaseName: "",
    versionConstraint: "",
    enabled: true,
    testKind: "readonly",
    purposes: freshPurposes(),
    tls: { enabled: false, caPem: "", clientCertPem: "", clientKeyPem: "" },
  };
}

function formForEdit(ds: Datasource): DatasourceFormState {
  const purposes = freshPurposes();
  for (const purpose of PURPOSES) {
    const configured = ds.credential_status[purpose] === true;
    purposes[purpose].included = configured;
    // Configured rows default to keep — the no-op that preserves the stored
    // credential; unconfigured rows can only replace.
    purposes[purpose].mode = configured ? "keep" : "replace";
  }
  return {
    name: ds.name,
    engine: ds.engine,
    compatibilityMode: ds.compatibility_mode,
    deploymentKind: ds.deployment_kind,
    host: ds.host,
    port: String(ds.port),
    databaseName: ds.database_name ?? "",
    versionConstraint: "",
    enabled: ds.enabled,
    testKind: ds.test_purpose === "execution" ? "readwrite" : "readonly",
    purposes,
    // Materials never echo; the checkbox reflects the current state only.
    tls: { enabled: ds.tls_verified, caPem: "", clientCertPem: "", clientKeyPem: "" },
  };
}

function CredentialPurposeRow({
  purpose,
  state,
  storedStatus,
  onChange,
}: {
  purpose: Purpose;
  state: PurposeFormState;
  /** Stored credential presence on the edited row (null on create): keep
   * and reuse resolve OLD stored rows only, so candidates come from the
   * view's credential_status — a purpose newly added in the same payload
   * cannot source a stored secret. */
  storedStatus: Record<string, boolean> | null;
  onChange: (next: PurposeFormState) => void;
}) {
  const { t } = useTranslation();
  const configured = storedStatus !== null && storedStatus[purpose] === true;
  const reuseSources = PURPOSES.filter(
    (candidate) => candidate !== purpose && storedStatus !== null && storedStatus[candidate] === true,
  );
  return (
    <div className="rounded-lg border p-3" data-testid={`credential-row-${purpose}`}>
      <div className="mb-2 flex items-center gap-2">
        <input
          type="checkbox"
          id={`credential-include-${purpose}`}
          checked={state.included}
          onChange={(event) => { onChange({ ...state, included: event.target.checked }); }}
          className="size-4"
          data-testid={`credential-include-${purpose}`}
        />
        <Label htmlFor={`credential-include-${purpose}`} className="cursor-pointer">
          {t(`admin.datasources.purpose.${purpose}`)}
        </Label>
        {configured ? (
          <Badge variant="secondary">{t("admin.datasources.credentialConfigured")}</Badge>
        ) : null}
      </div>
      {state.included ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label>{t("admin.datasources.credentialMode")}</Label>
            <Select
              value={state.mode}
              onValueChange={(next) => {
                if (next === null) return;
                // keep hides username/password entirely; switching away
                // starts from empty values so no stale secret input rides
                // along into the payload.
                onChange({
                  ...state,
                  mode: next,
                  username: next === "keep" ? "" : state.username,
                  password: next === "replace" ? state.password : "",
                  reuseSource: next === "reuse" ? state.reuseSource : "",
                });
              }}
              items={{
                replace: t("admin.datasources.modeReplace"),
                ...(reuseSources.length > 0
                  ? { reuse: t("admin.datasources.modeReuse") }
                  : {}),
                ...(configured ? { keep: t("admin.datasources.modeKeep") } : {}),
              }}
            >
              <SelectTrigger data-testid={`credential-mode-${purpose}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">{t("admin.datasources.modeReplace")}</SelectItem>
                {reuseSources.length > 0 ? (
                  <SelectItem value="reuse">{t("admin.datasources.modeReuse")}</SelectItem>
                ) : null}
                {configured ? (
                  <SelectItem value="keep">{t("admin.datasources.modeKeep")}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          {state.mode === "keep" ? (
            <p className="text-muted-foreground text-xs" data-testid={`credential-keep-note-${purpose}`}>
              {t("admin.datasources.keepNote")}
            </p>
          ) : null}
          {state.mode !== "keep" ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`credential-username-${purpose}`}>{t("admin.datasources.username")}</Label>
                <Input
                  id={`credential-username-${purpose}`}
                  value={state.username}
                  onChange={(event) => { onChange({ ...state, username: event.target.value }); }}
                  autoComplete="off"
                  data-testid={`credential-username-${purpose}`}
                />
              </div>
              {state.mode === "replace" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`credential-password-${purpose}`}>{t("admin.datasources.password")}</Label>
                  <Input
                    id={`credential-password-${purpose}`}
                    type="password"
                    value={state.password}
                    onChange={(event) => { onChange({ ...state, password: event.target.value }); }}
                    autoComplete="new-password"
                    data-testid={`credential-password-${purpose}`}
                  />
                </div>
              ) : null}
              {state.mode === "reuse" ? (
                <div className="flex flex-col gap-1">
                  <Label>{t("admin.datasources.reuseFrom")}</Label>
                  <Select
                    value={state.reuseSource === "" ? undefined : state.reuseSource}
                    onValueChange={(next) => {
                      if (next === null) return;
                      onChange({ ...state, reuseSource: next });
                    }}
                  >
                    <SelectTrigger data-testid={`credential-reuse-${purpose}`}>
                      <SelectValue placeholder={t("admin.datasources.reusePlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {reuseSources.map((candidate) => (
                        <SelectItem key={candidate} value={candidate}>
                          {t("admin.datasources.reuseCopyOf", { purpose: t(`admin.datasources.purpose.${candidate}`) })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}
          {state.mode === "reuse" ? (
            <p className="text-xs text-[var(--risk-warning)]">
              {t("admin.datasources.reuseRiskHint")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** TLS material section (declared DatasourceTLSWrite). Write-only PEM
 * textareas that never prefill; the client mirrors the pairing rule
 * (cert+key together) and the backend stays authoritative on PEM shape. */
function TLSMaterialSection({
  state,
  wasVerified,
  onChange,
}: {
  state: TLSFormState;
  /** tls_verified of the edited row: unchecking on a verified row is the
   * declared removal path and must say so before the submit. */
  wasVerified: boolean;
  onChange: (next: TLSFormState) => void;
}) {
  const { t } = useTranslation();
  const pairingBroken =
    state.enabled && (state.clientCertPem === "") !== (state.clientKeyPem === "");
  const noMaterial =
    state.enabled && state.caPem === "" && state.clientCertPem === "" && state.clientKeyPem === "";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="ds-tls-enabled"
          checked={state.enabled}
          onChange={(event) => { onChange({ ...state, enabled: event.target.checked }); }}
          className="size-4"
          data-testid="ds-tls-enabled"
        />
        <Label htmlFor="ds-tls-enabled" className="cursor-pointer">
          {t("admin.datasources.tlsTitle")}
        </Label>
        {wasVerified ? (
          <Badge variant="secondary">{t("admin.datasources.tlsVerifiedBadge")}</Badge>
        ) : null}
      </div>
      {!state.enabled && wasVerified ? (
        <Alert variant="destructive" data-testid="ds-tls-removal-warning">
          <AlertTitle>{t("admin.datasources.tlsRemovalTitle")}</AlertTitle>
          <AlertDescription>{t("admin.datasources.tlsRemovalBody")}</AlertDescription>
        </Alert>
      ) : null}
      {state.enabled ? (
        <>
          <p className="text-muted-foreground text-xs" data-testid="ds-tls-hint">
            {t("admin.datasources.tlsHint")}
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-tls-ca">{t("admin.datasources.tlsCa")}</Label>
              <Textarea
                id="ds-tls-ca"
                rows={3}
                value={state.caPem}
                onChange={(event) => { onChange({ ...state, caPem: event.target.value }); }}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
                data-testid="ds-tls-ca"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-tls-cert">{t("admin.datasources.tlsCert")}</Label>
              <Textarea
                id="ds-tls-cert"
                rows={3}
                value={state.clientCertPem}
                onChange={(event) => { onChange({ ...state, clientCertPem: event.target.value }); }}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
                data-testid="ds-tls-cert"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-tls-key">{t("admin.datasources.tlsKey")}</Label>
              <Textarea
                id="ds-tls-key"
                rows={3}
                value={state.clientKeyPem}
                onChange={(event) => { onChange({ ...state, clientKeyPem: event.target.value }); }}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="-----BEGIN PRIVATE KEY-----"
                data-testid="ds-tls-key"
              />
              <p className="text-muted-foreground text-xs">{t("admin.datasources.tlsPairHint")}</p>
            </div>
            {noMaterial ? (
              <p className="text-xs text-destructive" data-testid="ds-tls-empty-error">
                {t("admin.datasources.tlsEmptyError")}
              </p>
            ) : null}
            {pairingBroken ? (
              <p className="text-xs text-destructive" data-testid="ds-tls-pair-error">
                {t("admin.datasources.tlsPairError")}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DatasourceFormDialog({
  editing,
  onClose,
}: {
  editing: Datasource | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The dialog mounts per open (parent keys it by row), so the form state
  // initializes from the edited row without an effect-driven reset.
  const [form, setForm] = useState<DatasourceFormState>(() =>
    editing === null ? formForCreate() : formForEdit(editing),
  );
  const createMutation = useCreateDatasource();
  const replaceMutation = useReplaceDatasource();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  const engineModes: string[] = [
    ...(ENGINE_OPTIONS.find((option) => option.value === form.engine)?.modes ?? ["mysql"]),
  ];
  const modeLocked = form.engine !== "polardb";

  const mutation = editing === null ? createMutation : replaceMutation;
  const submitting = mutation.isPending;

  // Client-side mirrors of the declared write rules: a reuse row needs its
  // source picked, a replace row needs username+password, keep carries
  // neither, an enabled TLS block needs material with cert/key paired, the
  // base fields are minLength 1, and at least one purpose must stay in the
  // full-replacement payload (minItems 1). The backend stays authoritative —
  // these only keep obviously-invalid payloads from leaving the form.
  const tlsPairingBroken =
    form.tls.enabled && (form.tls.clientCertPem === "") !== (form.tls.clientKeyPem === "");
  const tlsEmpty =
    form.tls.enabled &&
    form.tls.caPem === "" &&
    form.tls.clientCertPem === "" &&
    form.tls.clientKeyPem === "";
  const purposeInvalid = PURPOSES.some((purpose) => {
    const state = form.purposes[purpose];
    if (!state.included) return false;
    if (state.mode === "keep") return false;
    if (state.mode === "reuse") return state.reuseSource === "" || state.username === "";
    return state.username === "" || state.password === "";
  });
  // The view never echoes version_constraint, so an edit must re-type it;
  // the port is minimum 1 / maximum 65535 (clearing it decodes to 0).
  const port = Number(form.port);
  const portInvalid = !Number.isInteger(port) || port < 1 || port > 65535;
  const basicsInvalid =
    form.name === "" || form.host === "" || form.versionConstraint === "" || portInvalid;
  const anyPurposeIncluded = PURPOSES.some((purpose) => form.purposes[purpose].included);
  const formValid =
    !tlsPairingBroken && !tlsEmpty && !purposeInvalid && !basicsInvalid && anyPurposeIncluded;

  const submit = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    const credentials: CredentialWrite[] = [];
    for (const purpose of PURPOSES) {
      const state = form.purposes[purpose];
      if (!state.included) continue;
      if (state.mode === "keep") {
        // keep: reuse_credential_purpose equal to the row's own purpose;
        // username and password must be ABSENT from the payload.
        credentials.push({ purpose, reuse_credential_purpose: purpose });
        continue;
      }
      if (state.mode === "reuse") {
        if (state.reuseSource === "") continue;
        credentials.push({
          purpose,
          username: state.username,
          reuse_credential_purpose: state.reuseSource,
        });
        continue;
      }
      credentials.push({
        purpose,
        username: state.username,
        password: { value: state.password },
      });
    }
    const tls = form.tls.enabled
      ? {
          ca_pem: form.tls.caPem === "" ? null : { value: form.tls.caPem },
          client_cert_pem: form.tls.clientCertPem === "" ? null : { value: form.tls.clientCertPem },
          client_key_pem: form.tls.clientKeyPem === "" ? null : { value: form.tls.clientKeyPem },
        }
      : null;
    const write: DatasourceWrite = {
      name: form.name,
      engine: form.engine as DatasourceWrite["engine"],
      compatibility_mode: form.compatibilityMode as DatasourceWrite["compatibility_mode"],
      deployment_kind: form.deploymentKind as DatasourceWrite["deployment_kind"],
      host: form.host,
      port: Number(form.port),
      database_name: form.databaseName === "" ? null : form.databaseName,
      version_constraint: form.versionConstraint,
      enabled: form.enabled,
      // §18.62：只读/读写解析到契约枚举——读写=执行凭据；只读=审核凭据，
      // 本次载荷不再保留审核凭据时回落查询凭据。
      test_purpose:
        form.testKind === "readwrite"
          ? "execution"
          : form.purposes.review.included
            ? "review"
            : "query",
      credentials,
      // Always explicit: null is the declared removal path, so an unchecked
      // box can never "accidentally" keep stale material.
      tls,
    };
    const onWriteError = (operationId: string) => (error: unknown) => {
      const display = describeError(error, operationId);
      setErrorKey(display.messageKey);
      setErrorRequestId(display.requestId);
    };
    if (editing === null) {
      createMutation.mutate(write, { onSuccess: onClose, onError: onWriteError("createDatasource") });
    } else {
      replaceMutation.mutate(
        { id: editing.id, version: editing.version, write },
        { onSuccess: onClose, onError: onWriteError("replaceDatasource") },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? t("admin.datasources.createTitle") : t("admin.datasources.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.datasources.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-name">{t("admin.datasources.name")}</Label>
              <Input
                id="ds-name"
                value={form.name}
                onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
                data-testid="ds-name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("admin.datasources.engine")}</Label>
              <Select
                value={form.engine}
                onValueChange={(next) => {
                  if (next === null) return;
                  const modes: string[] = [
                    ...(ENGINE_OPTIONS.find((option) => option.value === next)?.modes ?? []),
                  ];
                  const nextMode = modes.includes(form.compatibilityMode)
                    ? form.compatibilityMode
                    : (modes[0] ?? "mysql");
                  setForm({ ...form, engine: next, compatibilityMode: nextMode });
                }}
              >
                <SelectTrigger data-testid="ds-engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENGINE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("admin.datasources.compatibilityMode")}</Label>
              <Select
                value={form.compatibilityMode}
                onValueChange={(next) => {
                  if (next === null || modeLocked) return;
                  setForm({ ...form, compatibilityMode: next });
                }}
              >
                <SelectTrigger data-testid="ds-compat-mode" aria-disabled={modeLocked}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {engineModes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("admin.datasources.deploymentKind")}</Label>
              <Select
                value={form.deploymentKind}
                onValueChange={(next) => {
                  if (next === null) return;
                  setForm({ ...form, deploymentKind: next });
                }}
              >
                <SelectTrigger data-testid="ds-deployment-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="native">native</SelectItem>
                  <SelectItem value="cloud">cloud</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-host">{t("admin.datasources.host")}</Label>
              <Input
                id="ds-host"
                value={form.host}
                onChange={(event) => { setForm({ ...form, host: event.target.value }); }}
                data-testid="ds-host"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-port">{t("admin.datasources.port")}</Label>
              <Input
                id="ds-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) => { setForm({ ...form, port: event.target.value }); }}
                data-testid="ds-port"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-database-name">{t("admin.datasources.databaseName")}</Label>
              <Input
                id="ds-database-name"
                value={form.databaseName}
                onChange={(event) => { setForm({ ...form, databaseName: event.target.value }); }}
                data-testid="ds-database-name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-version-constraint">{t("admin.datasources.versionConstraint")}</Label>
              <Input
                id="ds-version-constraint"
                value={form.versionConstraint}
                onChange={(event) => { setForm({ ...form, versionConstraint: event.target.value }); }}
                placeholder=">=8.0,<9.0"
                data-testid="ds-version-constraint"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ds-enabled"
              checked={form.enabled}
              onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); }}
              className="size-4"
              data-testid="ds-enabled"
            />
            <Label htmlFor="ds-enabled" className="cursor-pointer">
              {t("admin.datasources.enabled")}
            </Label>
          </div>
          {/* §18.61 owner ruling: the connection-test purpose is a persisted
              datasource attribute changed HERE — never a per-row select in
              the table. The list's 测试连接 button probes with this
              purpose's stored credential. §18.62: the select speaks the
              same 只读/读写 credential-class vocabulary as the list badge. */}
          <div className="flex flex-col gap-1">
            <Label>{t("admin.datasources.testPurpose")}</Label>
            <Select
              value={form.testKind}
              onValueChange={(next) => {
                if (next !== null) setForm({ ...form, testKind: next });
              }}
              items={{
                readonly: t("admin.datasources.credModeReadOnly"),
                readwrite: t("admin.datasources.credModeReadWrite"),
              }}
            >
              <SelectTrigger data-testid="ds-test-purpose" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="readonly">{t("admin.datasources.credModeReadOnly")}</SelectItem>
                <SelectItem value="readwrite">{t("admin.datasources.credModeReadWrite")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{t("admin.datasources.testPurposeHint")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("admin.datasources.credentialsTitle")}</Label>
            {/* §18.63：用途行标签自带只读/读写类别（审核（只读）等），
                区块提示不再做标签插值。 */}
            <p className="text-muted-foreground text-xs">
              {t("admin.datasources.credentialsHint")}
            </p>
            {PURPOSES.map((purpose) => (
              <CredentialPurposeRow
                key={purpose}
                purpose={purpose}
                state={form.purposes[purpose]}
                storedStatus={editing !== null ? editing.credential_status : null}
                onChange={(next) => { setForm({ ...form, purposes: { ...form.purposes, [purpose]: next } }); }}
              />
            ))}
          </div>
          <TLSMaterialSection
            state={form.tls}
            wasVerified={editing !== null && editing.tls_verified}
            onChange={(next) => { setForm({ ...form, tls: next }); }}
          />
          {errorKey !== null ? (
            <Alert variant="destructive" data-testid="ds-form-error">
              <AlertTitle>{t(errorKey)}</AlertTitle>
              <AlertDescription>
                {errorRequestId !== null ? `request_id: ${errorRequestId}` : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {!formValid ? (
            <p className="text-muted-foreground text-xs" data-testid="ds-form-invalid-hint">
              {t("admin.datasources.formInvalidHint")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting || !formValid} data-testid="ds-submit">
            {submitting ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapabilityMatrix({ datasourceId, probeKey }: { datasourceId: string; probeKey: string }) {
  const { t } = useTranslation();
  const capabilitiesQuery = useDatasourceCapabilities(datasourceId, probeKey, datasourceId !== "");
  if (capabilitiesQuery.isPending || capabilitiesQuery.isError) return null;
  const capabilities = capabilitiesQuery.data;
  if (capabilities === null) {
    return (
      <p className="text-muted-foreground text-xs" data-testid="ds-capabilities-waiting">
        {t("admin.datasources.testRunning")}
      </p>
    );
  }
  const unavailable = Object.entries(capabilities.capabilities).filter(([, ok]) => !ok);
  return (
    <Card data-testid="ds-capabilities">
      <CardHeader>
        <CardTitle className="text-sm">{t("admin.datasources.capabilitiesTitle")}</CardTitle>
        <CardDescription className="font-mono text-xs">
          {t("admin.datasources.detectedVersion", { version: capabilities.detected_version })} ·{" "}
          {t("admin.datasources.identityFingerprint")}: {capabilities.identity_fingerprint}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {Object.entries(capabilities.capabilities).map(([name, ok]) => (
          <Badge key={name} variant={ok ? "default" : "outline"} data-testid={`ds-capability-${name}`}>
            {name}: {ok ? t("admin.datasources.capabilityOk") : t("admin.datasources.capabilityUnavailable")}
          </Badge>
        ))}
      </CardContent>
      {unavailable.length > 0 ? (
        <CardContent className="pt-0">
          <Alert className="border-[var(--risk-warning)]/40">
            <AlertTitle>{t("admin.datasources.unavailableTitle")}</AlertTitle>
            <AlertDescription>
              {t("admin.datasources.unavailableExplanation", {
                capabilities: unavailable.map(([name]) => name).join(", "),
              })}
            </AlertDescription>
          </Alert>
        </CardContent>
      ) : null}
    </Card>
  );
}

function ConnectionTestControls({
  datasource,
  onTestStarted,
}: {
  datasource: Datasource;
  onTestStarted: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const [taskId, setTaskId] = useState<string | null>(null);
  const testMutation = useTestDatasourceConnection();
  const taskQuery = useAdminTask(taskId ?? "", taskId !== null);
  const [testErrorKey, setTestErrorKey] = useState<string | null>(null);
  // §18.76补（owner裁定沿Provider拒因透出路径）：同步拒因走meta.detail；
  // 异步Task失败走task.error.detail（Probe真实失败原因，非笼统文案）。
  const [testErrorDetail, setTestErrorDetail] = useState<string | null>(null);

  const runTest = () => {
    setTestErrorKey(null);
    setTestErrorDetail(null);
    // §18.61：探测用途取数据源持久化的test_purpose（编辑表单变更），
    // 表格不再出现用途选择器。
    testMutation.mutate(
      { id: datasource.id, purpose: datasource.test_purpose },
      {
        onSuccess: (task) => {
          setTaskId(task.id);
          onTestStarted(task.id);
        },
        onError: (error) => {
          const display = describeError(error, "testDatasourceConnection");
          setTestErrorKey(display.messageKey);
          setTestErrorDetail(display.detail);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={runTest}
          disabled={testMutation.isPending || taskQuery.data?.state === "running" || taskQuery.data?.state === "queued"}
          data-testid={`ds-test-button-${datasource.id}`}
        >
          <PlugZap /> {t("admin.datasources.testConnection")}
        </Button>
      </div>
      {taskQuery.data?.state === "queued" || taskQuery.data?.state === "running" ? (
        <p className="text-muted-foreground text-xs">{t("admin.datasources.testRunning")}</p>
      ) : null}
      {/* owner真机：测试成功此前零反馈（旧代码只画运行中/失败两态）——
          补成功行，与新拒因渲染对称。 */}
      {taskQuery.data?.state === "succeeded" ? (
        <p
          className="text-right text-xs text-[var(--risk-safe)]"
          data-testid={`ds-test-ok-${datasource.id}`}
        >
          {t("admin.datasources.testOk")}
        </p>
      ) : null}
      {taskQuery.data?.state === "failed" ? (
        <div className="flex flex-col items-end text-right">
          <p className="text-xs text-destructive">{t("admin.datasources.testFailed")}</p>
          {taskQuery.data.error?.detail ? (
            <p
              className="break-all font-mono text-xs text-destructive"
              data-testid={`ds-test-error-detail-${datasource.id}`}
            >
              {taskQuery.data.error.detail}
            </p>
          ) : null}
        </div>
      ) : null}
      {testErrorKey !== null ? (
        <div className="flex flex-col items-end text-right">
          <p className="text-xs text-destructive">{t(testErrorKey)}</p>
          {testErrorDetail !== null ? (
            <p
              className="break-all font-mono text-xs text-destructive"
              data-testid={`ds-test-error-detail-${datasource.id}`}
            >
              {testErrorDetail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DatasourceRow({
  datasource,
  onEdit,
  onDelete,
  onTestStarted,
}: {
  datasource: Datasource;
  onEdit: () => void;
  onDelete: () => void;
  onTestStarted: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableRow data-testid={`ds-row-${datasource.id}`} data-row-key={datasource.id}>
      <TableCell className="font-medium">
        {datasource.name}
        {datasource.enabled ? null : (
          <Badge variant="outline" className="ml-2">
            {t("admin.datasources.disabled")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {datasource.engine}/{datasource.compatibility_mode}
      </TableCell>
      <TableCell className="font-mono text-xs">
        <div className="flex flex-col items-start gap-1">
          <span>
            {datasource.host}:{datasource.port}
          </span>
          <Badge
            variant={datasource.tls_verified ? "secondary" : "outline"}
            data-testid={`ds-tls-${datasource.tls_verified ? "verified" : "plaintext"}-${datasource.id}`}
          >
            {datasource.tls_verified
              ? t("admin.datasources.tlsVerifiedBadge")
              : t("admin.datasources.tlsPlaintextBadge")}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        {/* §18.58 owner ruling: the credential state is a single 只读/读写
            badge (read-write = execution credential stored); the per-purpose
            detail and every credential change live in the edit dialog (B13
            keep/replace/reuse), never in the table. */}
        <Badge
          variant={datasource.credential_status.execution === true ? "secondary" : "outline"}
          data-testid={`ds-cred-mode-${datasource.credential_status.execution === true ? "readwrite" : "readonly"}`}
        >
          {datasource.credential_status.execution === true
            ? t("admin.datasources.credModeReadWrite")
            : t("admin.datasources.credModeReadOnly")}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {t("admin.datasources.referencedBy", { count: datasource.referenced_by_flow_count ?? 0 })}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <ConnectionTestControls datasource={datasource} onTestStarted={onTestStarted} />
          <Button variant="ghost" size="sm" onClick={onEdit} data-testid={`ds-edit-${datasource.id}`}>
            <Pencil /> {t("common.edit")}
          </Button>
          {/* §18.58: a referenced datasource cannot be deleted (1107, 只能停
              用) — the disabled button carries a Tooltip explaining why. The
              trigger is an interactive span wrapper: disabled buttons swallow
              pointer events, so the tooltip could never open on the button
              itself. */}
          {(datasource.referenced_by_flow_count ?? 0) > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="inline-flex"
                      data-testid={`ds-delete-${datasource.id}`}
                    >
                      <Button variant="ghost" size="sm" disabled>
                        <Trash2 /> {t("common.delete")}
                      </Button>
                    </span>
                  }
                />
                <TooltipContent data-testid={`ds-delete-tooltip-${datasource.id}`}>
                  {t("admin.datasources.deleteBlockedHint")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button variant="ghost" size="sm" onClick={onDelete} data-testid={`ds-delete-${datasource.id}`}>
              <Trash2 /> {t("common.delete")}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function DeleteConfirmDialog({
  datasource,
  onClose,
}: {
  datasource: Datasource;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteDatasource();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.datasources.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("admin.datasources.deleteDescription", { name: datasource.name })}</DialogDescription>
        </DialogHeader>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="ds-delete-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>{t("admin.datasources.deleteErrorHint")}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => { deleteMutation.mutate(
                { id: datasource.id, version: datasource.version },
                {
                  onSuccess: onClose,
                  onError: (error) => {
                    const display = describeError(error, "deleteDatasource");
                    setErrorKey(display.messageKey);
                  },
                },
              ); }
            }
            data-testid="ds-delete-confirm"
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminDatasourcesPage() {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const pager = useCursorPage(20);
  const [search, setSearch] = useState("");

  const query = useDatasources(enabled, { limit: pager.pageSize, after: pager.after, q: search.trim() || undefined });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Datasource | null>(null);
  const [deleting, setDeleting] = useState<Datasource | null>(null);
  // Expanded capability row: datasource id + the probe task id that keyed
  // the latest capabilities fetch (a re-test starts a fresh key).
  const [probe, setProbe] = useState<{ datasourceId: string; taskId: string } | null>(null);
  // §18.73：搜索走服务端q（名称/主机子串）；keyword仅用于空态文案区分。
  const keyword = search.trim();
  const datasources = query.data?.items ?? [];
  // 搜索/翻页改变行集合时，把整行位移补间掉；能力探测行不带 data-row-key，不参与。
  const datasourcesBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(datasources.map((datasource) => datasource.id)),
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("admin.datasources.title")}</CardTitle>
            <CardDescription>{t("admin.datasources.description")}</CardDescription>
          </div>
          <TableSearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                pager.reset();
              }}
              testId="admin-datasources-search"
            />
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="ds-create"
          >
            <Plus /> {t("admin.datasources.createTitle")}
          </Button>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} operationId="listDatasources" onRetry={() => void query.refetch()} />
          ) : datasources.length === 0 && keyword !== "" ? (
            <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-datasources-search-empty">
              {t("table.emptySearch")}
            </p>
          ) : query.data.items.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Database />
                </EmptyMedia>
                <EmptyTitle>{t("admin.datasources.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("admin.datasources.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.datasources.name")}</TableHead>
                  <TableHead>{t("admin.datasources.engine")}</TableHead>
                  <TableHead>{t("admin.datasources.endpoint")}</TableHead>
                  <TableHead>{t("admin.datasources.credentialStatus")}</TableHead>
                  <TableHead>{t("admin.datasources.references")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={datasourcesBodyRef} stale={query.isFetching && query.isPlaceholderData}>
                {datasources.map((datasource) => (
                  <Fragment key={datasource.id}>
                    <DatasourceRow
                      datasource={datasource}
                      onEdit={() => {
                        setEditing(datasource);
                        setDialogOpen(true);
                      }}
                      onDelete={() => { setDeleting(datasource); }}
                      onTestStarted={(taskId) => { setProbe({ datasourceId: datasource.id, taskId }); }}
                    />
                    {probe !== null && probe.datasourceId === datasource.id ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <CapabilityMatrix datasourceId={datasource.id} probeKey={probe.taskId} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            </>
          )}
      {!query.isPending && !query.isError ? (
        <TablePagination
          busy={query.isFetching && query.isPlaceholderData}
          page={pager.pageNo}
          hasMore={query.data.page.has_more}
          isFirst={pager.isFirst}
          onPrev={pager.goPrev}
          onNext={() => {
            pager.pushCursor(query.data.page.next_cursor);
          }}
          pageSize={pager.pageSize}
          onPageSizeChange={pager.setPageSize}
          testIdPrefix="datasources"
        />
      ) : null}
        </CardContent>
      </Card>
      {dialogOpen ? (
        <DatasourceFormDialog
          key={editing?.id ?? "new"}
          editing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
      {deleting !== null ? (
        <DeleteConfirmDialog
          key={deleting.id}
          datasource={deleting}
          onClose={() => { setDeleting(null); }}
        />
      ) : null}
    </div>
  );
}
