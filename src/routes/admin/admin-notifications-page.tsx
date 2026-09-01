import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, FlaskConical, Plus } from "lucide-react";
import type {
  DingTalkNotificationConfig as DingTalkConfig,
  EmailNotificationConfig as EmailConfig,
  NotificationChannel,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
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
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useNotificationDeliveries,
  useReplaceNotificationChannel,
  useTestNotificationDelivery,
} from "@/features/admin/use-admin";

/**
 * 通知设置 (route /admin/settings/notifications; S003). Channels are the
 * Outbox-driven email/DingTalk senders — secrets never回填
 * (secret_configured presence only; create requires a secret, replace keeps
 * or replaces). The deliveries table shows the honest Outbox state machine
 * (queued → sending → succeeded/failed, ≤5 attempts then dead_letter);
 * test deliveries go through the same Outbox loop, not a side channel.
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

interface ChannelDraft {
  kind: "email" | "dingtalk";
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  tlsMode: "required" | "starttls";
  username: string;
  fromAddress: string;
  secret: string;
}

const EMPTY_CHANNEL: ChannelDraft = {
  kind: "email",
  name: "",
  enabled: false,
  host: "",
  port: 465,
  tlsMode: "required",
  username: "",
  fromAddress: "",
  secret: "",
};

export default function AdminNotificationsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const channelsQuery = useNotificationChannels(isAdmin);
  const deliveriesQuery = useNotificationDeliveries(isAdmin);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);

  const channels = channelsQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="admin-notifications-page">
      <PageBreadcrumb title={t("nav.admin.settings")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminNotifications.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("adminNotifications.description")}</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); }} data-testid="admin-notifications-create">
          <Plus />
          {t("adminNotifications.create")}
        </Button>
      </header>

      {channelsQuery.isPending && <LoadingState />}
      {channelsQuery.error !== null && (
        <ErrorState error={channelsQuery.error} operationId="listNotificationChannels" onRetry={() => void channelsQuery.refetch()} />
      )}

      {!channelsQuery.isPending && channelsQuery.error === null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell className="size-4" />
              {t("adminNotifications.channels")}
            </CardTitle>
            <CardDescription>{t("adminNotifications.channelsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-notifications-empty">
                {t("adminNotifications.empty")}
              </p>
            ) : (
              <Table data-testid="admin-notifications-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminNotifications.column.kind")}</TableHead>
                    <TableHead>{t("adminNotifications.column.name")}</TableHead>
                    <TableHead>{t("adminNotifications.column.enabled")}</TableHead>
                    <TableHead>{t("adminNotifications.column.secret")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map((channel) => (
                    <ChannelRow key={channel.id} channel={channel} onEdit={() => { setEditing(channel); }} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!deliveriesQuery.isPending && deliveries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("adminNotifications.deliveries")}</CardTitle>
            <CardDescription>{t("adminNotifications.deliveriesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table data-testid="admin-deliveries-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminNotifications.column.state")}</TableHead>
                  <TableHead>{t("adminNotifications.column.attempts")}</TableHead>
                  <TableHead>{t("adminNotifications.column.nextAttempt")}</TableHead>
                  <TableHead>{t("adminNotifications.column.lastError")}</TableHead>
                  <TableHead>{t("adminNotifications.column.createdAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery.id} data-testid={`admin-delivery-row-${delivery.id}`}>
                    <TableCell>
                      <Badge
                        variant={
                          delivery.state === "succeeded" ? "secondary" : delivery.state === "dead_letter" ? "destructive" : "outline"
                        }
                      >
                        {t(`adminNotifications.deliveryState.${delivery.state}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{delivery.delivery_attempt_count}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {delivery.next_attempt_at === null || delivery.next_attempt_at === undefined
                        ? "—"
                        : delivery.next_attempt_at.replace("T", " ").replace("Z", " UTC")}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {delivery.last_error_code ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {delivery.created_at.replace("T", " ").replace("Z", " UTC")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ChannelFormDialog open={createOpen} editing={null} onClose={() => { setCreateOpen(false); }} />
      <ChannelFormDialog open={editing !== null} editing={editing} onClose={() => { setEditing(null); }} />
    </div>
  );
}

function ChannelRow({ channel, onEdit }: { channel: NotificationChannel; onEdit: () => void }) {
  const { t } = useTranslation();
  const deleteChannel = useDeleteNotificationChannel();
  const testDelivery = useTestNotificationDelivery();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  return (
    <>
      <TableRow data-testid={`admin-channel-row-${channel.id}`}>
        <TableCell>
          <Badge variant="outline">{channel.kind}</Badge>
        </TableCell>
        <TableCell>{channel.name}</TableCell>
        <TableCell>
          <Badge variant={channel.enabled ? "secondary" : "outline"}>
            {channel.enabled ? t("adminNotifications.enabled") : t("adminNotifications.disabled")}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {channel.secret_configured ? t("adminNotifications.secretConfigured") : t("adminNotifications.secretMissing")}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={testDelivery.isPending}
              onClick={() => { testDelivery.mutate(
                  { channelId: channel.id, body: {} },
                  {
                    onError: (error) => { setErrorText(describeErrorText(describeError(error, "createNotificationTestDelivery"))); },
                  },
                ); }
              }
              data-testid={`admin-channel-test-${channel.id}`}
            >
              <FlaskConical />
              {t("adminNotifications.test")}
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("common.edit")}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => { setConfirmOpen(true); }} data-testid={`admin-channel-delete-${channel.id}`}>
              {t("common.delete")}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {errorText !== null && (
        <TableRow>
          <TableCell colSpan={5}>
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          </TableCell>
        </TableRow>
      )}

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!next) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminNotifications.delete.title", { name: channel.name })}</DialogTitle>
            <DialogDescription>{t("adminNotifications.delete.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteChannel.isPending}
              onClick={() => { deleteChannel.mutate(
                  { channelId: channel.id, version: channel.version },
                  { onSuccess: () => { setConfirmOpen(false); } },
                ); }
              }
            >
              {deleteChannel.isPending ? t("common.saving") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChannelFormDialog({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: NotificationChannel | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createChannel = useCreateNotificationChannel();
  const replaceChannel = useReplaceNotificationChannel();
  const [draft, setDraft] = useState<ChannelDraft>(EMPTY_CHANNEL);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const formKey = editing?.id ?? "create";
  if (open && openFor !== formKey) {
    setOpenFor(formKey);
    setErrorText(null);
    if (editing === null) {
      setDraft(EMPTY_CHANNEL);
    } else {
      const configuration = editing.configuration as unknown as Record<string, string | number>;
      setDraft({
        kind: editing.kind,
        name: editing.name,
        enabled: editing.enabled,
        host: String(configuration.host ?? ""),
        port: Number(configuration.port ?? 465),
        tlsMode: configuration.tls_mode as "required" | "starttls",
        username: String(configuration.username ?? ""),
        fromAddress: String(configuration.from_address ?? ""),
        secret: "",
      });
    }
  }
  if (!open && openFor !== null) setOpenFor(null);

  const submit = async () => {
    setErrorText(null);
    const configuration: EmailConfig | DingTalkConfig =
      draft.kind === "dingtalk"
        ? { webhook_host: "oapi.dingtalk.com" }
        : {
            host: draft.host,
            port: draft.port,
            tls_mode: draft.tlsMode,
            username: draft.username,
            from_address: draft.fromAddress,
          };
    if (editing === null && draft.secret === "") {
      setErrorText(t("adminNotifications.secretRequired"));
      return;
    }
    try {
      if (editing === null) {
        await createChannel.mutateAsync({
          kind: draft.kind,
          name: draft.name,
          enabled: draft.enabled,
          configuration,
          secret: { value: draft.secret },
        });
      } else {
        await replaceChannel.mutateAsync({
          channelId: editing.id,
          version: editing.version,
          body: {
            kind: draft.kind,
            name: draft.name,
            enabled: draft.enabled,
            configuration,
            secret: draft.secret === "" ? undefined : { value: draft.secret },
          },
        });
      }
      onClose();
    } catch (error) {
      setErrorText(
        describeErrorText(describeError(error, editing === null ? "createNotificationChannel" : "replaceNotificationChannel")),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing === null ? t("adminNotifications.createTitle") : t("adminNotifications.editTitle", { name: editing.name })}</DialogTitle>
          <DialogDescription>{t("adminNotifications.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label>{t("adminNotifications.column.kind")}</Label>
            <select
              value={draft.kind}
              disabled={editing !== null}
              onChange={(event) => { setDraft({ ...draft, kind: event.target.value as "email" | "dingtalk" }); }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              data-testid="channel-kind"
            >
              <option value="email">email</option>
              <option value="dingtalk">dingtalk</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">{t("adminNotifications.column.name")}</Label>
            <Input id="channel-name" value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); }} maxLength={128} data-testid="channel-name" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }); }}
              data-testid="channel-enabled"
            />
            {t("adminNotifications.column.enabled")}
          </label>
          {draft.kind === "email" && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-host">{t("adminNotifications.field.host")}</Label>
                <Input id="channel-host" value={draft.host} onChange={(event) => { setDraft({ ...draft, host: event.target.value }); }} data-testid="channel-host" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-port">{t("adminNotifications.field.port")}</Label>
                <Input id="channel-port" type="number" min={1} max={65535} value={draft.port} onChange={(event) => { setDraft({ ...draft, port: Number(event.target.value) }); }} data-testid="channel-port" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("adminNotifications.field.tls")}</Label>
                <select
                  value={draft.tlsMode}
                  onChange={(event) => { setDraft({ ...draft, tlsMode: event.target.value as "required" | "starttls" }); }}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  data-testid="channel-tls"
                >
                  <option value="required">required</option>
                  <option value="starttls">starttls</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-username">{t("adminNotifications.field.username")}</Label>
                <Input id="channel-username" value={draft.username} onChange={(event) => { setDraft({ ...draft, username: event.target.value }); }} data-testid="channel-username" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-from">{t("adminNotifications.field.from")}</Label>
                <Input id="channel-from" type="email" value={draft.fromAddress} onChange={(event) => { setDraft({ ...draft, fromAddress: event.target.value }); }} data-testid="channel-from" />
              </div>
            </>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-secret">{t("adminNotifications.field.secret")}</Label>
            <Input id="channel-secret" type="password" value={draft.secret} onChange={(event) => { setDraft({ ...draft, secret: event.target.value }); }} data-testid="channel-secret" />
            <p className="text-muted-foreground text-xs">
              {editing === null ? t("adminNotifications.field.secretCreateHint") : t("adminNotifications.field.secretEditHint")}
            </p>
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="channel-form-error">
              <AlertTitle>{t("adminNotifications.formFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={draft.name.trim() === "" || createChannel.isPending || replaceChannel.isPending}
            onClick={() => void submit()}
            data-testid="channel-form-submit"
          >
            {createChannel.isPending || replaceChannel.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
