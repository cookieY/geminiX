import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bell, CheckCircle2, FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  DingTalkNotificationConfig as DingTalkConfig,
  EmailNotificationConfig as EmailConfig,
  FeishuNotificationConfig as FeishuConfig,
  SlackNotificationConfig as SlackConfig,
  NotificationChannel,
  NotificationChannelKind,
  NotificationDelivery,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { SettingsNavTabs } from "@/routes/admin/settings-tabs";
import { RulesView } from "@/routes/admin/admin-notification-rules-view";
import { useNotificationRules } from "@/features/admin/use-admin";
import { describeError } from "@/shared/api/error-display";
import { PageHeader, PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { StatusBadge } from "@/shared/components/status/status-badge";
import type { StatusTone } from "@/shared/lib/status-tone";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { NumberInput } from "@/shared/components/ui/number-input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { PasswordInput } from "@/shared/components/ui/password-input";
import { AnimatePresence, motion } from "motion/react";
import { useFlipReorder } from "@/shared/lib/use-flip-reorder";
import {
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useNotificationChannels,
  useNotificationDeliveries,
  useNotificationTestTask,
  useReplaceNotificationChannel,
  useTestNotificationDelivery,
} from "@/features/admin/use-admin";
import { useCursorPage } from "@/shared/lib/cursor-page";
import { TablePagination } from "@/shared/components/ui/table-pagination";
import { DropdownMenuItem } from "@/shared/components/ui/dropdown-menu";
import { TableRowActions } from "@/shared/components/table-row-actions";

/**
 * 通知设置 (route /admin/settings/notifications; S003). Channels are the
 * Outbox-driven email/DingTalk senders — secrets never回填
 * (secret_configured presence only; create requires a secret, replace keeps
 * or replaces). The deliveries table shows the honest Outbox state machine
 * (queued → sending → succeeded/failed, ≤5 attempts then dead_letter);
 * test deliveries go through the same Outbox loop, not a side channel.
 */

function deliveryStateTone(state: NotificationDelivery["state"]): StatusTone {
  switch (state) {
    case "queued":
      return "sky";
    case "sending":
      return "indigo";
    case "succeeded":
      return "emerald";
    case "failed":
      return "rose";
    case "dead_letter":
      return "red";
    default:
      return "stone";
  }
}

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

interface ChannelDraft {
  kind: NotificationChannelKind;
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  tlsMode: "required" | "starttls";
  username: string;
  fromAddress: string;
  secret: string;
  // 钉钉专用：加签Secret（机器人安全设置=加签模式时必填）；与Webhook
  // 一同组成{access_token,sign_secret}信封（senders.SendDingTalk口径）。
  signSecret: string;
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
  signSecret: "",
};

// 钉钉机器人凭据=webhook URL里的access_token路径段（senders.SendDingTalk）。
// 允许粘贴完整Webhook地址（取access_token参数），也兼容直接粘贴裸token。
function dingTalkToken(raw: string): string {
  const text = raw.trim();
  try {
    const url = new URL(text);
    const token = url.searchParams.get("access_token");
    if (token !== null && token !== "") return token;
  } catch {
    // 非URL输入按裸access_token处理。
  }
  return text;
}

// 钉钉凭据信封：填了加签Secret走{access_token,sign_secret}信封（后端加签
// 模式），否则裸token（与存量渠道/免签机器人兼容）。
function dingTalkSecretValue(token: string, signSecret: string): string {
  const sign = signSecret.trim();
  if (sign === "") return token;
  return JSON.stringify({ access_token: token, sign_secret: sign });
}

export default function AdminNotificationsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  // S007三视图：渠道/规则/投递记录同页切换（不发明新路由）。
  const [view, setView] = useState<"channels" | "rules" | "deliveries">("channels");
  const [deliveryStateFilter, setDeliveryStateFilter] = useState<"all" | NotificationDelivery["state"]>("all");
  const pager = useCursorPage(20);
  const channelsQuery = useNotificationChannels(isAdmin, { limit: pager.pageSize, after: pager.after });
  // §18.82：先于穷尽三元捕获，避免收窄泄漏进分页守卫。
  const channelsLoaded = !channelsQuery.isPending && !channelsQuery.isError;
  const deliveriesQuery = useNotificationDeliveries(isAdmin);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);

  const channels = channelsQuery.data?.items ?? [];
  const deliveries = deliveriesQuery.data?.items ?? [];
  // 渠道表有游标分页且新建/删除会改变行集合；投递记录表只随轮询更新。
  const channelsBodyRef = useFlipReorder<HTMLTableSectionElement>(
    JSON.stringify(channels.map((channel) => channel.id)),
  );

  return (
    <PageLayout data-testid="admin-notifications-page">
      <PageHeader
        title={t("adminNotifications.title")}
        description={t("adminNotifications.description")}
        icon={Bell}
        actions={<SettingsNavTabs current="notifications" />}
      />

      {/* tabs-02 reference（owner ruling 2026-10-24）：UI库Tabs + TransitionPanel
          切换动效（滑入+模糊），不再用手写按钮组。 */}
      <Tabs
        value={view}
        onValueChange={(next) => {
          if (next === "channels" || next === "rules" || next === "deliveries") setView(next as "channels" | "rules" | "deliveries");
        }}
      >
        <TabsList aria-label={t("adminNotifications.views")}>
          {(
            [
              ["channels", t("adminNotifications.channels")],
              ["rules", t("adminNotifications.rules")],
              ["deliveries", t("adminNotifications.deliveries")],
            ] as const
          ).map(([key, label]) => (
            <TabsTrigger
              key={key}
              value={key}
              data-testid={`admin-notifications-view-${key}`}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 与设置族四命名空间页同一动效（owner ruling 2026-10-31二轮：六个
          设置tab切换一致）——AnimatePresence fade/rise按view键控；三视图
          各自条件渲染，同一时刻只挂载当前视图（owner四轮）。 */}
      <AnimatePresence mode="wait">
        {view === "channels" && (
        <motion.div
          key="channels"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex flex-col gap-5"
        >
          {channelsQuery.isPending && <LoadingState variant="page" />}
          {channelsQuery.error !== null && (
            <ErrorState error={channelsQuery.error} operationId="listNotificationChannels" onRetry={() => void channelsQuery.refetch()} />
          )}

          {!channelsQuery.isPending && channelsQuery.error === null && (
            <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <Bell className="size-4" />
              {t("adminNotifications.channels")}
            </CardTitle>
            <CardDescription>{t("adminNotifications.channelsDescription")}</CardDescription>
            {/* 新建通道=表头行最右（owner四轮裁定，与其他表格卡一致）。 */}
            <CardAction>
              <Button onClick={() => { setCreateOpen(true); }} data-testid="admin-notifications-create">
                <Plus />
                {t("adminNotifications.create")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0!">
            {channels.length === 0 ? (
              <EmptyState title={t("adminNotifications.empty")} testId="admin-notifications-empty" />
            ) : (
              <>
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
                <TableBody ref={channelsBodyRef} stale={channelsQuery.isFetching && channelsQuery.isPlaceholderData}>
                  {channels.map((channel) => (
                    <ChannelRow key={channel.id} channel={channel} onEdit={() => { setEditing(channel); }} />
                  ))}
                </TableBody>
              </Table>
              </>
            )}
              {channelsLoaded ? (
                <TablePagination
                  busy={channelsQuery.isFetching && channelsQuery.isPlaceholderData}
                  page={pager.pageNo}
                  hasMore={channelsQuery.data.page.has_more}
                  isFirst={pager.isFirst}
                  onPrev={pager.goPrev}
          onJumpPage={pager.goToPage}
                  onNext={() => {
                    pager.pushCursor(channelsQuery.data.page.next_cursor);
                  }}
                  pageSize={pager.pageSize}
                  onPageSizeChange={pager.setPageSize}
                  rowsOnPage={channelsQuery.data.items.length}
                  testIdPrefix="notifications"
                />
              ) : null}
          </CardContent>
          </Card>
          )}
        </motion.div>
        )}

        {view === "rules" && (
        <motion.div
          key="rules"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex flex-col gap-5"
        >
          <RulesView isAdmin={isAdmin} />
        </motion.div>
        )}

        {view === "deliveries" && (
        <motion.div
          key="deliveries"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex flex-col gap-5"
        >
        <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle>{t("adminNotifications.deliveries")}</CardTitle>
          <CardDescription>{t("adminNotifications.deliveriesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="px-0!">
          <div className="mb-3 flex items-center gap-2 px-6">
            <Label htmlFor="delivery-state-filter" className="text-sm text-muted-foreground">
              {t("adminNotifications.filter.state")}
            </Label>
            <Select
              value={deliveryStateFilter}
              onValueChange={(value) => { if (value !== null) { setDeliveryStateFilter(value); } }}
            >
              <SelectTrigger id="delivery-state-filter" className="w-40" data-testid="delivery-state-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminNotifications.filter.all")}</SelectItem>
                <SelectItem value="queued">{t("adminNotifications.deliveryState.queued")}</SelectItem>
                <SelectItem value="sending">{t("adminNotifications.deliveryState.sending")}</SelectItem>
                <SelectItem value="succeeded">{t("adminNotifications.deliveryState.succeeded")}</SelectItem>
                <SelectItem value="failed">{t("adminNotifications.deliveryState.failed")}</SelectItem>
                <SelectItem value="dead_letter">{t("adminNotifications.deliveryState.dead_letter")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {deliveriesQuery.isPending ? (
            <LoadingState variant="table" columns={8} />
          ) : deliveriesQuery.error !== null ? (
            <ErrorState
              error={deliveriesQuery.error}
              operationId="listNotificationDeliveries"
              onRetry={() => void deliveriesQuery.refetch()}
            />
          ) : deliveries.length === 0 ? (
            <EmptyState
              title={t("adminNotifications.deliveries")}
              description={t("adminNotifications.deliveriesDescription")}
            />
          ) : (
            <Table data-testid="admin-deliveries-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminNotifications.column.event")}</TableHead>
                  <TableHead>{t("adminNotifications.column.channelCol")}</TableHead>
                  <TableHead>{t("adminNotifications.column.target")}</TableHead>
                  <TableHead>{t("adminNotifications.column.state")}</TableHead>
                  <TableHead>{t("adminNotifications.column.attempts")}</TableHead>
                  <TableHead>{t("adminNotifications.column.nextAttempt")}</TableHead>
                  <TableHead>{t("adminNotifications.column.lastError")}</TableHead>
                  <TableHead>{t("adminNotifications.column.createdAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries
                  .filter((delivery) => deliveryStateFilter === "all" || delivery.state === deliveryStateFilter)
                  .map((delivery) => (
                  <TableRow key={delivery.id} data-testid={`admin-delivery-row-${delivery.id}`}>
                    <TableCell className="font-mono text-xs">{delivery.event_type}</TableCell>
                    <TableCell>{delivery.channel_name}</TableCell>
                    <TableCell className="font-mono text-xs">{delivery.masked_target}</TableCell>
                    <TableCell>
                      <StatusBadge tone={deliveryStateTone(delivery.state)}>
                        {t(`adminNotifications.deliveryState.${delivery.state}`)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-base font-semibold tabular-nums text-foreground">
                      {delivery.delivery_attempt_count}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {delivery.next_attempt_at === null || delivery.next_attempt_at === undefined
                        ? "—"
                        : delivery.next_attempt_at.replace("T", " ").replace("Z", " UTC")}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">
                      {delivery.last_error_code ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {delivery.created_at.replace("T", " ").replace("Z", " UTC")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </motion.div>
        )}
      </AnimatePresence>

      <ChannelFormDialog open={createOpen && view === "channels"} editing={null} onClose={() => { setCreateOpen(false); }} />
      <ChannelFormDialog open={editing !== null} editing={editing} onClose={() => { setEditing(null); }} />
    </PageLayout>
  );
}

function ChannelRow({ channel, onEdit }: { channel: NotificationChannel; onEdit: () => void }) {
  const { t } = useTranslation();
  const deleteChannel = useDeleteNotificationChannel();
  const testDelivery = useTestNotificationDelivery();
  // 2026-10-31三轮：测试投递是异步任务——受理回执的task_id经
  // useNotificationTestTask轮询到终态，行内显示是否投递成功。
  const [testTaskId, setTestTaskId] = useState<string | null>(null);
  const testTaskQuery = useNotificationTestTask(testTaskId);
  const rulesQuery = useNotificationRules(true);
  const referencedRules = (rulesQuery.data?.items ?? []).filter((rule) => rule.channel_id === channel.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  return (
    <>
      <TableRow data-row-key={channel.id} data-testid={`admin-channel-row-${channel.id}`}>
        <TableCell>
          <Badge variant="outline">{channel.kind}</Badge>
        </TableCell>
        <TableCell className="font-semibold text-foreground">{channel.name}</TableCell>
        <TableCell>
          <StatusBadge tone={channel.enabled ? "emerald" : "stone"}>
            {channel.enabled ? t("adminNotifications.enabled") : t("adminNotifications.disabled")}
          </StatusBadge>
        </TableCell>
        <TableCell>
          <StatusBadge tone={channel.secret_configured ? "emerald" : "red"}>
            {channel.secret_configured ? t("adminNotifications.secretConfigured") : t("adminNotifications.secretMissing")}
          </StatusBadge>
        </TableCell>
        <TableCell className="text-right">
          <TableRowActions testId={`admin-channel-actions-${channel.id}`}>
            <DropdownMenuItem
              disabled={testDelivery.isPending}
              aria-busy={testDelivery.isPending || undefined}
              onClick={() => { testDelivery.mutate(
                  { channelId: channel.id, body: {} },
                  {
                    onSuccess: (receipt) => { setTestTaskId(receipt.task_id); setErrorText(null); },
                    onError: (error) => { setErrorText(describeErrorText(describeError(error, "createNotificationTestDelivery"))); },
                  },
                ); }
              }
              data-testid={`admin-channel-test-${channel.id}`}
            >
              {testDelivery.isPending ? <Spinner aria-hidden /> : <FlaskConical />}
              {t("adminNotifications.test")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit} data-testid={`admin-channel-edit-${channel.id}`}>
              <Pencil /> {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => { setConfirmOpen(true); }} data-testid={`admin-channel-delete-${channel.id}`}>
              <Trash2 /> {t("common.delete")}
            </DropdownMenuItem>
          </TableRowActions>
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
      {testTaskId !== null && (
        <TableRow>
          <TableCell colSpan={5} data-testid={`admin-channel-test-result-${channel.id}`}>
            {(() => {
              // 终态=成功/失败/取消；查询错误或未终态=进行中（Worker异步消费，
              // 真实后端测试投递不落投递记录表，结果只在任务面）。
              const state = testTaskQuery.data?.state;
              if (state === "succeeded") {
                return (
                  <div className="flex items-center gap-2 text-xs text-[var(--risk-safe)]">
                    <CheckCircle2 className="size-4" aria-hidden />
                    {t("adminNotifications.testResult.succeeded")}
                  </div>
                );
              }
              if (state === "failed" || state === "cancelled") {
                const failureName = testTaskQuery.data?.error?.title ?? testTaskQuery.error?.message;
                return (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="size-4" aria-hidden />
                    {t("adminNotifications.testResult.failed")}
                    {failureName !== undefined && failureName !== "" ? `（${failureName}）` : null}
                  </div>
                );
              }
              return (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-4" aria-hidden />
                  {t("adminNotifications.testResult.running")}
                </div>
              );
            })()}
          </TableCell>
        </TableRow>
      )}

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!next) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminNotifications.delete.title", { name: channel.name })}</DialogTitle>
            <DialogDescription>{t("adminNotifications.delete.description")}</DialogDescription>
            {referencedRules.length > 0 && (
              <DialogDescription data-testid="channel-referenced-rules">
                {t("adminNotifications.referencedRules", { count: referencedRules.length, names: referencedRules.map((rule) => rule.name).join("、") })}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <PendingButton
              variant="destructive"
              pending={deleteChannel.isPending}
              onClick={() => { deleteChannel.mutate(
                  { channelId: channel.id, version: channel.version },
                  { onSuccess: () => { setConfirmOpen(false); } },
                ); }
              }
            >
              {t("common.delete")}
            </PendingButton>
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
        signSecret: "",
      });
    }
  }
  if (!open && openFor !== null) setOpenFor(null);

  const submit = async () => {
    setErrorText(null);
    // 钉钉：输入框收完整Webhook URL或裸token，提交按后端口径归一为
    // access_token；填了加签Secret则组成{access_token,sign_secret}信封。
    const dingToken = draft.kind === "dingtalk" ? dingTalkToken(draft.secret) : "";
    const secretValue = draft.kind === "dingtalk"
      ? dingTalkSecretValue(dingToken, draft.signSecret)
      : draft.secret;
    const configuration: EmailConfig | DingTalkConfig | FeishuConfig | SlackConfig =
      draft.kind === "dingtalk"
        ? { webhook_host: "oapi.dingtalk.com" }
        : draft.kind === "feishu"
          ? {}
          : draft.kind === "slack"
            ? {}
            : {
                host: draft.host,
                port: draft.port,
                tls_mode: draft.tlsMode,
                username: draft.username,
                from_address: draft.fromAddress,
              };
    if (editing === null && (draft.kind === "dingtalk" ? dingToken : draft.secret) === "") {
      setErrorText(
        draft.kind === "dingtalk"
          ? t("adminNotifications.webhookRequired")
          : t("adminNotifications.secretRequired"),
      );
      return;
    }
    try {
      if (editing === null) {
        await createChannel.mutateAsync({
          kind: draft.kind,
          name: draft.name,
          enabled: draft.enabled,
          configuration,
          secret: { value: secretValue },
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
            secret: secretValue === "" ? undefined : { value: secretValue },
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
            <Label htmlFor="channel-kind">{t("adminNotifications.column.kind")}</Label>
            <Select
              value={draft.kind}
              disabled={editing !== null}
              onValueChange={(value) => {
                if (value !== "email" && value !== "dingtalk" && value !== "feishu" && value !== "slack") return;
                setDraft({ ...draft, kind: value });
              }}
            >
              <SelectTrigger
                id="channel-kind"
                className="w-48"
                data-testid="channel-kind"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">email</SelectItem>
                <SelectItem value="dingtalk">dingtalk</SelectItem>
                <SelectItem value="feishu">feishu</SelectItem>
                <SelectItem value="slack">slack</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">{t("adminNotifications.column.name")}</Label>
            <Input id="channel-name" value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); }} maxLength={128} data-testid="channel-name" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="channel-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => { setDraft({ ...draft, enabled: checked }); }}
              data-testid="channel-enabled"
            />
            <Label htmlFor="channel-enabled" className="cursor-pointer">
              {t("adminNotifications.column.enabled")}
            </Label>
          </div>
          {draft.kind === "email" && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-host">{t("adminNotifications.field.host")}</Label>
                <Input id="channel-host" value={draft.host} onChange={(event) => { setDraft({ ...draft, host: event.target.value }); }} data-testid="channel-host" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-port">{t("adminNotifications.field.port")}</Label>
                <NumberInput id="channel-port" min={1} max={65535} value={draft.port} onChange={(event) => { setDraft({ ...draft, port: Number(event.target.value) }); }} data-testid="channel-port" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-tls">{t("adminNotifications.field.tls")}</Label>
                <Select
                  value={draft.tlsMode}
                  onValueChange={(value) => {
                    if (value !== "required" && value !== "starttls") return;
                    setDraft({ ...draft, tlsMode: value });
                  }}
                >
                  <SelectTrigger
                    id="channel-tls"
                    className="w-48"
                    data-testid="channel-tls"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">required</SelectItem>
                    <SelectItem value="starttls">starttls</SelectItem>
                  </SelectContent>
                </Select>
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
          {draft.kind === "dingtalk" ? (
            // 钉钉凭据=机器人Webhook URL（含access_token）+可选加签Secret，
            // 两个独立输入框；提交时解析出access_token并按需组成信封
            // （senders.SendDingTalk口径）。
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-webhook">{t("adminNotifications.field.webhook")}</Label>
                <PasswordInput
                  id="channel-webhook"
                  value={draft.secret}
                  onChange={(event) => { setDraft({ ...draft, secret: event.target.value }); }}
                  autoComplete="new-password"
                  data-testid="channel-webhook"
                />
                <p className="text-muted-foreground text-xs">
                  {editing === null
                    ? t("adminNotifications.field.webhookCreateHint")
                    : t("adminNotifications.field.webhookEditHint")}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel-sign-secret">{t("adminNotifications.field.signSecret")}</Label>
                <PasswordInput
                  id="channel-sign-secret"
                  value={draft.signSecret}
                  onChange={(event) => { setDraft({ ...draft, signSecret: event.target.value }); }}
                  autoComplete="new-password"
                  data-testid="channel-sign-secret"
                />
                <p className="text-muted-foreground text-xs">
                  {t("adminNotifications.field.signSecretHint")}
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="channel-secret">{t("adminNotifications.field.secret")}</Label>
              <PasswordInput
                id="channel-secret"
                value={draft.secret}
                onChange={(event) => { setDraft({ ...draft, secret: event.target.value }); }}
                autoComplete="new-password"
                data-testid="channel-secret"
              />
              <p className="text-muted-foreground text-xs">
                {draft.kind === "feishu" || draft.kind === "slack"
                  ? editing === null
                    ? t("adminNotifications.field.secretWebhookCreateHint")
                    : t("adminNotifications.field.secretWebhookEditHint")
                  : editing === null
                    ? t("adminNotifications.field.secretCreateHint")
                    : t("adminNotifications.field.secretEditHint")}
              </p>
            </div>
          )}
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
          <PendingButton
            pending={createChannel.isPending || replaceChannel.isPending}
            disabled={draft.name.trim() === ""}
            onClick={() => void submit()}
            data-testid="channel-form-submit"
          >
            {t("common.save")}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
