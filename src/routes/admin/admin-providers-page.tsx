import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import type {
  AiProvider,
  AiProviderWrite,
  CreateAiProviderRequest,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useAdminTask,
  useAiProviders,
  useCreateAiProvider,
  useDeleteAiProvider,
  useReplaceAiProvider,
  useTestAiProviderConnection,
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
 * Provider 管理 (route /admin/review-engine/providers; UI spec §5.3 puts
 * provider administration in the review-engine group). The list renders the
 * primary/backup order exactly as the runtime consumes it —
 * selection_priority ascending (backend provider/chain.go:3), index 0 is
 * the primary. The API key is write-only: create requires it once, replace
 * keeps the stored key unless a new one is typed, and every read face
 * exposes only api_key_configured. privacy_contract_hash and
 * output_schema_hash inputs carry the frozen contract hashes the runtime
 * verifies (R008/R005 boundary: no per-order budget here — that is the
 * ai-budget settings namespace).
 */

interface ProviderFormState {
  name: string;
  providerKind: string;
  baseUrl: string;
  modelName: string;
  enabled: boolean;
  selectionPriority: string;
  apiKey: string;
  privacyContractHash: string;
  outputSchemaHash: string;
}

function emptyProviderForm(): ProviderFormState {
  return {
    name: "",
    providerKind: "openai_compatible",
    baseUrl: "",
    modelName: "",
    enabled: true,
    selectionPriority: "10",
    apiKey: "",
    privacyContractHash: "",
    outputSchemaHash: "",
  };
}

function providerFormForEdit(provider: AiProvider): ProviderFormState {
  return {
    name: provider.name,
    providerKind: provider.provider_kind,
    baseUrl: provider.base_url,
    modelName: provider.model_name,
    enabled: provider.enabled,
    selectionPriority: String(provider.selection_priority),
    // Never prefilled: an empty key field on edit means "keep the stored
    // key" (gate: Secret永不回填).
    apiKey: "",
    privacyContractHash: "",
    outputSchemaHash: "",
  };
}

function ProviderFormDialog({
  editing,
  onClose,
}: {
  editing: AiProvider | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Keyed per open by the parent: state initializes from the edited row.
  const [form, setForm] = useState<ProviderFormState>(() =>
    editing === null ? emptyProviderForm() : providerFormForEdit(editing),
  );
  const createMutation = useCreateAiProvider();
  const replaceMutation = useReplaceAiProvider();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);

  const mutation = editing === null ? createMutation : replaceMutation;

  const submit = () => {
    setErrorKey(null);
    setErrorRequestId(null);
    const apiKey =
      form.apiKey === ""
        ? undefined
        : ({ value: form.apiKey });
    if (editing === null) {
      if (apiKey === undefined) {
        setErrorKey("errors.VALIDATION_FAILED");
        return;
      }
      const write = {
        name: form.name,
        provider_kind: form.providerKind,
        base_url: form.baseUrl,
        model_name: form.modelName,
        enabled: form.enabled,
        selection_priority: Number(form.selectionPriority),
        privacy_contract_hash: form.privacyContractHash,
        output_schema_hash: form.outputSchemaHash,
        api_key: apiKey,
      } as CreateAiProviderRequest;
      createMutation.mutate(write, {
        onSuccess: onClose,
        onError: (error) => {
          const display = describeError(error, "createAiProvider");
          setErrorKey(display.messageKey);
          setErrorRequestId(display.requestId);
        },
      });
    } else {
      const write: AiProviderWrite = {
        name: form.name,
        provider_kind: form.providerKind,
        base_url: form.baseUrl,
        model_name: form.modelName,
        enabled: form.enabled,
        selection_priority: Number(form.selectionPriority),
        privacy_contract_hash: form.privacyContractHash,
        output_schema_hash: form.outputSchemaHash,
        ...(apiKey === undefined ? {} : { api_key: apiKey }),
      };
      replaceMutation.mutate(
        { id: editing.id, version: editing.version, write },
        {
          onSuccess: onClose,
          onError: (error) => {
            const display = describeError(error, "replaceAiProvider");
            setErrorKey(display.messageKey);
            setErrorRequestId(display.requestId);
          },
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? t("admin.providers.createTitle") : t("admin.providers.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.providers.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-name">{t("admin.providers.name")}</Label>
            <Input
              id="provider-name"
              value={form.name}
              onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
              data-testid="provider-name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-kind">{t("admin.providers.kind")}</Label>
            <Input
              id="provider-kind"
              value={form.providerKind}
              onChange={(event) => { setForm({ ...form, providerKind: event.target.value }); }}
              data-testid="provider-kind"
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="provider-base-url">{t("admin.providers.baseUrl")}</Label>
            <Input
              id="provider-base-url"
              value={form.baseUrl}
              onChange={(event) => { setForm({ ...form, baseUrl: event.target.value }); }}
              placeholder="https://api.example.com/v1"
              data-testid="provider-base-url"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-model">{t("admin.providers.model")}</Label>
            <Input
              id="provider-model"
              value={form.modelName}
              onChange={(event) => { setForm({ ...form, modelName: event.target.value }); }}
              data-testid="provider-model"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-priority">{t("admin.providers.priority")}</Label>
            <Input
              id="provider-priority"
              type="number"
              min={1}
              max={100}
              value={form.selectionPriority}
              onChange={(event) => { setForm({ ...form, selectionPriority: event.target.value }); }}
              data-testid="provider-priority"
            />
            <p className="text-muted-foreground text-xs">{t("admin.providers.priorityHint")}</p>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="provider-api-key">{t("admin.providers.apiKey")}</Label>
            <Input
              id="provider-api-key"
              type="password"
              value={form.apiKey}
              onChange={(event) => { setForm({ ...form, apiKey: event.target.value }); }}
              autoComplete="new-password"
              placeholder={
                editing !== null && editing.api_key_configured
                  ? t("admin.providers.apiKeyKeepPlaceholder")
                  : ""
              }
              data-testid="provider-api-key"
            />
            {editing !== null ? (
              <p className="text-muted-foreground text-xs">
                {t("admin.providers.apiKeyConfigured", {
                  state: editing.api_key_configured
                    ? t("admin.providers.configured")
                    : t("admin.providers.notConfigured"),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-privacy-hash">{t("admin.providers.privacyHash")}</Label>
            <Input
              id="provider-privacy-hash"
              value={form.privacyContractHash}
              onChange={(event) => { setForm({ ...form, privacyContractHash: event.target.value }); }}
              data-testid="provider-privacy-hash"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-schema-hash">{t("admin.providers.schemaHash")}</Label>
            <Input
              id="provider-schema-hash"
              value={form.outputSchemaHash}
              onChange={(event) => { setForm({ ...form, outputSchemaHash: event.target.value }); }}
              data-testid="provider-schema-hash"
            />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              id="provider-enabled"
              checked={form.enabled}
              onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); }}
              className="size-4"
              data-testid="provider-enabled"
            />
            <Label htmlFor="provider-enabled" className="cursor-pointer">
              {t("admin.providers.enabled")}
            </Label>
          </div>
        </div>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="provider-form-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>
              {errorRequestId !== null ? `request_id: ${errorRequestId}` : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending} data-testid="provider-submit">
            {mutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({
  provider,
  ordinal,
  onEdit,
  onAskDelete,
}: {
  provider: AiProvider;
  ordinal: number;
  onEdit: () => void;
  onAskDelete: () => void;
}) {
  const { t } = useTranslation();
  const testMutation = useTestAiProviderConnection();
  const [taskId, setTaskId] = useState<string | null>(null);
  const taskQuery = useAdminTask(taskId ?? "", taskId !== null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // The latest task stays rendered (terminal states stop polling); a new
  // test replaces it from the click handler.

  return (
    <TableRow data-testid={`provider-row-${provider.id}`}>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Badge variant={ordinal === 0 ? "default" : "outline"} data-testid={`provider-role-${provider.id}`}>
            {ordinal === 0 ? t("admin.providers.primary") : t("admin.providers.backup")}
          </Badge>
          <span className="font-medium">{provider.name}</span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{provider.provider_kind}</TableCell>
      <TableCell className="max-w-48 truncate font-mono text-xs">{provider.base_url}</TableCell>
      <TableCell className="font-mono text-xs">{provider.model_name}</TableCell>
      <TableCell className="font-mono text-xs">{provider.selection_priority}</TableCell>
      <TableCell>
        <Badge
          variant={provider.enabled ? "default" : "outline"}
          data-testid={`provider-enabled-${provider.id}`}
        >
          {provider.enabled ? t("admin.providers.enabled") : t("admin.providers.disabled")}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant={provider.api_key_configured ? "secondary" : "destructive"}
          data-testid={`provider-apikey-${provider.id}`}
        >
          <KeyRound className="mr-1 size-3" />
          {provider.api_key_configured
            ? t("admin.providers.configured")
            : t("admin.providers.notConfigured")}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={testMutation.isPending}
            onClick={() => { testMutation.mutate(
                { id: provider.id },
                {
                  onSuccess: (task) => { setTaskId(task.id); },
                  onError: (error) => {
                    const display = describeError(error, "testAiProviderConnection");
                    setErrorKey(display.messageKey);
                  },
                },
              ); }
            }
            data-testid={`provider-test-${provider.id}`}
          >
            {t("admin.datasources.testConnection")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} data-testid={`provider-edit-${provider.id}`}>
            {t("common.edit")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onAskDelete} data-testid={`provider-delete-${provider.id}`}>
            <Trash2 /> {t("common.delete")}
          </Button>
        </div>
        {taskQuery.data?.state === "queued" || taskQuery.data?.state === "running" ? (
          <p className="text-muted-foreground mt-1 text-right text-xs">{t("admin.datasources.testRunning")}</p>
        ) : null}
        {taskQuery.data?.state === "succeeded" ? (
          <p className="mt-1 text-right text-xs text-[var(--risk-safe)]">{t("admin.providers.testOk")}</p>
        ) : null}
        {taskQuery.data?.state === "failed" ? (
          <p className="mt-1 text-right text-xs text-destructive">{t("admin.providers.testFailed")}</p>
        ) : null}
        {errorKey !== null ? <p className="mt-1 text-right text-xs text-destructive">{t(errorKey)}</p> : null}
      </TableCell>
    </TableRow>
  );
}

function ProviderDeleteDialog({
  provider,
  onClose,
}: {
  provider: AiProvider;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteAiProvider();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.providers.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("admin.providers.deleteDescription", { name: provider.name })}</DialogDescription>
        </DialogHeader>
        {errorKey !== null ? (
          <Alert variant="destructive" data-testid="provider-delete-error">
            <AlertTitle>{t(errorKey)}</AlertTitle>
            <AlertDescription>{errorKey === "errors.generic.business" ? t("admin.providers.deleteErrorHint") : null}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate(
                { id: provider.id, version: provider.version },
                {
                  onSuccess: onClose,
                  onError: (error) => {
                    const display = describeError(error, "deleteAiProvider");
                    setErrorKey(display.messageKey);
                  },
                },
              );
            }}
            data-testid="provider-delete-confirm"
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminProvidersPage() {
  const { t } = useTranslation();
  const session = useSession();
  const enabled = session.user?.can_access_admin === true;
  const query = useAiProviders(enabled);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<AiProvider | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb title={t("nav.reviewEngine.providers")} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("admin.providers.title")}</CardTitle>
            <CardDescription>{t("admin.providers.description")}</CardDescription>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="provider-create"
          >
            <Plus /> {t("admin.providers.createTitle")}
          </Button>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState error={query.error} operationId="listAiProviders" onRetry={() => void query.refetch()} />
          ) : query.data.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>{t("admin.providers.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("admin.providers.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.providers.name")}</TableHead>
                  <TableHead>{t("admin.providers.kind")}</TableHead>
                  <TableHead>{t("admin.providers.baseUrl")}</TableHead>
                  <TableHead>{t("admin.providers.model")}</TableHead>
                  <TableHead>{t("admin.providers.priority")}</TableHead>
                  <TableHead>{t("admin.providers.enabled")}</TableHead>
                  <TableHead>{t("admin.providers.apiKey")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((provider, index) => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    ordinal={index}
                    onEdit={() => {
                      setEditing(provider);
                      setDialogOpen(true);
                    }}
                    onAskDelete={() => { setDeleting(provider); }}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {deleting !== null ? (
        <ProviderDeleteDialog
          key={deleting.id}
          provider={deleting}
          onClose={() => { setDeleting(null); }}
        />
      ) : null}
      {dialogOpen ? (
        <ProviderFormDialog
          key={editing?.id ?? "new"}
          editing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
