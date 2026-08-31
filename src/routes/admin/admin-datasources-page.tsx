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
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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

/**
 * 数据源管理（route /admin/datasources；migration contract §2 maps the
 * legacy /manager/db here with the §3 field reorganization). The form carries
 * Engine/兼容模式/部署类型/版本约束 and the Review/Query/Execution purpose
 * credentials; the legacy flow_id/rule_id/principal/is_query/SSL-file fields
 * are consciously gone. Secrets are write-only: the API never echoes a
 * credential, the form never prefills one, and a password is either typed
 * fresh (replace) or explicitly reused from another purpose's stored
 * credential (datasource/service.go replaceCredentials — full-set
 * replacement with cross-purpose reuse, the minimal-privilege risk of which
 * the form must warn about).
 *
 * TLS material has no declared fields in the frozen OpenAPI (the
 * datasource_tls_materials table is backend-internal and only entered via
 * the legacy migration) — no TLS form is rendered and none is invented;
 * recorded in migration contract §16.
 */

const PURPOSES = ["review", "query", "execution"] as const;
type Purpose = (typeof PURPOSES)[number];

const ENGINE_OPTIONS = [
  { value: "mysql", modes: ["mysql"] },
  { value: "postgresql", modes: ["postgresql"] },
  { value: "tidb", modes: ["mysql"] },
  { value: "oceanbase", modes: ["mysql"] },
  { value: "polardb", modes: ["mysql", "postgresql"] },
] as const;

interface PurposeFormState {
  included: boolean;
  username: string;
  password: string;
  /** "typed" = supply a fresh password; otherwise copy the stored
   * credential of the chosen purpose (backend reuse_credential_purpose). */
  reuse: Purpose | "typed";
}

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
  purposes: Record<Purpose, PurposeFormState>;
}

function freshPurposes(): Record<Purpose, PurposeFormState> {
  return {
    review: { included: true, username: "", password: "", reuse: "typed" },
    query: { included: false, username: "", password: "", reuse: "typed" },
    execution: { included: false, username: "", password: "", reuse: "typed" },
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
    purposes: freshPurposes(),
  };
}

function formForEdit(ds: Datasource): DatasourceFormState {
  const purposes = freshPurposes();
  for (const purpose of PURPOSES) {
    purposes[purpose].included = ds.credential_status[purpose] === true;
    purposes[purpose].reuse = "typed";
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
    purposes,
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
  /** Stored credential presence on the edited row (null on create): reuse
   * resolves OLD stored rows only, so candidates come from the view's
   * credential_status — a purpose newly added in the same payload cannot
   * source a stored secret. */
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
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`credential-username-${purpose}`}>{t("admin.datasources.username")}</Label>
            <Input
              id={`credential-username-${purpose}`}
              value={state.username}
              onChange={(event) => { onChange({ ...state, username: event.target.value }); }}
              autoComplete="off"
              placeholder={configured ? t("admin.datasources.usernameNotEchoed") : ""}
              data-testid={`credential-username-${purpose}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`credential-password-${purpose}`}>{t("admin.datasources.password")}</Label>
            <Input
              id={`credential-password-${purpose}`}
              type="password"
              value={state.password}
              onChange={(event) => { onChange({ ...state, password: event.target.value, reuse: "typed" }); }}
              autoComplete="new-password"
              placeholder={configured ? t("admin.datasources.passwordKeepPlaceholder") : ""}
              data-testid={`credential-password-${purpose}`}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>{t("admin.datasources.reuseFrom")}</Label>
            <Select
              value={state.reuse}
              onValueChange={(next) => {
                if (next === null) return;
                // Choosing a reuse source discards the typed value (it would
                // be ignored by the write); "typed" keeps it.
                onChange({ ...state, reuse: next, password: next === "typed" ? state.password : "" });
              }}
            >
              <SelectTrigger data-testid={`credential-reuse-${purpose}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="typed">{t("admin.datasources.reuseTyped")}</SelectItem>
                {reuseSources.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {t("admin.datasources.reuseCopyOf", { purpose: t(`admin.datasources.purpose.${candidate}`) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.reuse !== "typed" ? (
              <p className="text-xs text-[var(--risk-warning)]">
                {t("admin.datasources.reuseRiskHint")}
              </p>
            ) : null}
          </div>
        </div>
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

  const submit = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    const credentials: CredentialWrite[] = [];
    for (const purpose of PURPOSES) {
      const state = form.purposes[purpose];
      if (!state.included) continue;
      credentials.push({
        purpose,
        username: state.username,
        password: state.reuse === "typed" ? { value: state.password } : undefined,
        reuse_credential_purpose: state.reuse === "typed" ? undefined : state.reuse,
      });
    }
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
      credentials,
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
          <div className="flex flex-col gap-2">
            <Label>{t("admin.datasources.credentialsTitle")}</Label>
            <p className="text-muted-foreground text-xs">
              {t("admin.datasources.credentialsHint", {
                review: t("admin.datasources.purpose.review"),
                query: t("admin.datasources.purpose.query"),
                execution: t("admin.datasources.purpose.execution"),
              })}
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
          {errorKey !== null ? (
            <Alert variant="destructive" data-testid="ds-form-error">
              <AlertTitle>{t(errorKey)}</AlertTitle>
              <AlertDescription>
                {errorRequestId !== null ? `request_id: ${errorRequestId}` : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting} data-testid="ds-submit">
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
  const [purpose, setPurpose] = useState<Purpose>("review");
  const [taskId, setTaskId] = useState<string | null>(null);
  const testMutation = useTestDatasourceConnection();
  const taskQuery = useAdminTask(taskId ?? "", taskId !== null);
  const [testErrorKey, setTestErrorKey] = useState<string | null>(null);

  const runTest = () => {
    setTestErrorKey(null);
    // Expanding the capability matrix is a user-event side effect; the
    // matrix is keyed by the probe task id and polls until the probe
    // materializes the facts.
    testMutation.mutate(
      { id: datasource.id, purpose },
      {
        onSuccess: (task) => {
          setTaskId(task.id);
          onTestStarted(task.id);
        },
        onError: (error) => {
          const display = describeError(error, "testDatasourceConnection");
          setTestErrorKey(display.messageKey);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Select value={purpose} onValueChange={(next) => { if (next !== null) setPurpose(next); }}>
          <SelectTrigger className="h-8 w-32" data-testid={`ds-test-purpose-${datasource.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PURPOSES.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {t(`admin.datasources.purpose.${candidate}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      {taskQuery.data?.state === "failed" ? (
        <p className="text-xs text-destructive">{t("admin.datasources.testFailed")}</p>
      ) : null}
      {testErrorKey !== null ? <p className="text-xs text-destructive">{t(testErrorKey)}</p> : null}
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
    <TableRow data-testid={`ds-row-${datasource.id}`}>
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
        {datasource.host}:{datasource.port}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          {PURPOSES.map((purpose) => (
            <Badge
              key={purpose}
              variant={datasource.credential_status[purpose] === true ? "secondary" : "outline"}
              data-testid={`ds-cred-${purpose}-${datasource.credential_status[purpose] === true ? "ok" : "missing"}`}
            >
              {t(`admin.datasources.purpose.${purpose}`)}
            </Badge>
          ))}
        </div>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={(datasource.referenced_by_flow_count ?? 0) > 0}
            title={
              (datasource.referenced_by_flow_count ?? 0) > 0
                ? t("admin.datasources.deleteBlockedHint")
                : undefined
            }
            data-testid={`ds-delete-${datasource.id}`}
          >
            <Trash2 /> {t("common.delete")}
          </Button>
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
  const query = useDatasources(enabled);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Datasource | null>(null);
  const [deleting, setDeleting] = useState<Datasource | null>(null);
  // Expanded capability row: datasource id + the probe task id that keyed
  // the latest capabilities fetch (a re-test starts a fresh key).
  const [probe, setProbe] = useState<{ datasourceId: string; taskId: string } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("nav.admin.datasources")} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("admin.datasources.title")}</CardTitle>
            <CardDescription>{t("admin.datasources.description")}</CardDescription>
          </div>
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
          ) : query.data.length === 0 ? (
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
              <TableBody>
                {query.data.map((datasource) => (
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
          )}
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
