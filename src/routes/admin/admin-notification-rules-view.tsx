// S007通知规则视图（FE-F10-NOTIFICATION-CENTER）：规则CRUD+预览。
// 规则=名称+启停+流程范围(空=全部)+一个触发事件+一个目标角色+一个渠道；
// 预览只解析目标与渲染固定文案，绝不发送、不改状态。事件词汇来自
// NotificationRuleEventType（AI预审族结构性排除——生成类型即词汇表）。
import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import type {
  NotificationChannel,
  NotificationRule,
  NotificationRuleEventType,
  NotificationRulePreview,
  NotificationRuleTargetKind,
  NotificationRuleWrite,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  useCreateNotificationRule,
  useDeleteNotificationRule,
  useFlows,
  useNotificationChannels,
  useNotificationRules,
  usePreviewNotificationRule,
  useReplaceNotificationRule,
} from "@/features/admin/use-admin";
import { describeError } from "@/shared/api/error-display";
import { PageLayout } from "@/shared/components/page-layout";
import { PendingButton } from "@/shared/components/pending-button";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { StatusBadge } from "@/shared/components/status/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

const EVENT_TYPES: NotificationRuleEventType[] = [
  "change_order.submitted",
  "change_order.step_activated",
  "change_order.approval_decided",
  "change_order.stage_ready_for_execution",
  "change_order.rejected",
  "change_order.withdrawn",
  "change_order.voided",
  "execution.scheduled",
  "execution.schedule_cancelled",
  "execution.started",
  "execution.succeeded",
  "execution.failed",
  "execution.partial_failed",
  "execution.cancelled",
  "execution.partial_cancelled",
  "execution.result_unknown",
  "execution.blocked_datasource_unavailable",
  "execution.missed_schedule",
  "query_grant.revoked",
  "ai.budget_warning",
  "ai.budget_exhausted",
  "ai.provider_failover",
];

const TARGET_KINDS: NotificationRuleTargetKind[] = [
  "order_submitter",
  "stage_approvers",
  "stage_executors",
  "grant_requester",
  "builtin_admins",
];

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

export function RulesView({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const rulesQuery = useNotificationRules(isAdmin);
  const channelsQuery = useNotificationChannels(isAdmin, { limit: 100 });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationRule | null>(null);

  const rules = rulesQuery.data?.items ?? [];
  const channels = channelsQuery.data?.items ?? [];

  return (
    <PageLayout data-testid="admin-notification-rules">
      {rulesQuery.isPending && <LoadingState variant="page" />}
      {rulesQuery.error !== null && (
        <ErrorState error={rulesQuery.error} operationId="listNotificationRules" onRetry={() => void rulesQuery.refetch()} />
      )}
      {rulesQuery.data !== undefined && (
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle>{t("adminRules.title")}</CardTitle>
            <CardDescription>{t("adminRules.description")}</CardDescription>
            {/* 新建规则=表头行最右（owner四轮裁定，与通知通道卡一致）。 */}
            {isAdmin && (
              <CardAction>
                <Button onClick={() => { setCreateOpen(true); }} data-testid="admin-rules-create">
                  <Plus />
                  {t("adminRules.create")}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="px-0!">
            {rules.length === 0 ? (
              <EmptyState title={t("adminRules.empty")} testId="admin-rules-empty" />
            ) : (
            <Table data-testid="admin-rules-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminRules.column.name")}</TableHead>
                  <TableHead>{t("adminRules.column.event")}</TableHead>
                  <TableHead>{t("adminRules.column.target")}</TableHead>
                  <TableHead>{t("adminRules.column.channel")}</TableHead>
                  <TableHead>{t("adminRules.column.enabled")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => {
                  const channel = channels.find((c: NotificationChannel) => c.id === rule.channel_id);
                  return (
                    <TableRow key={rule.id} data-testid={`admin-rule-row-${rule.id}`}>
                      <TableCell>{rule.name}</TableCell>
                      <TableCell className="font-mono text-xs">{rule.event_type}</TableCell>
                      <TableCell>{t(`adminRules.target.${rule.target_kind}`)}</TableCell>
                      <TableCell>{channel?.name ?? t("adminRules.channelMissing")}</TableCell>
                      <TableCell>
                        <StatusBadge tone={rule.enabled ? "emerald" : "stone"}>
                          {rule.enabled ? t("common.enabled") : t("common.disabled")}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(rule); }} data-testid={`admin-rule-edit-${rule.id}`}>
                          <Pencil />
                        </Button>
                        <RuleDeleteButton rule={rule} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      )}

      <RuleFormDialog open={createOpen} editing={null} onClose={() => { setCreateOpen(false); }} />
      <RuleFormDialog open={editing !== null} editing={editing} onClose={() => { setEditing(null); }} />
    </PageLayout>
  );
}

function RuleDeleteButton({ rule }: { rule: NotificationRule }) {
  const { t } = useTranslation();
  const deleteRule = useDeleteNotificationRule();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => { setConfirmOpen(true); }} data-testid={`admin-rule-delete-${rule.id}`}>
        <Trash2 />
      </Button>
      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!next) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminRules.deleteTitle", { name: rule.name })}</DialogTitle>
            <DialogDescription>{t("adminRules.deleteDescription")}</DialogDescription>
          </DialogHeader>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="rule-delete-error">
              <AlertTitle>{t("adminRules.deleteFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <PendingButton
              pending={deleteRule.isPending}
              onClick={() => {
                deleteRule.mutate(
                  { ruleId: rule.id, version: rule.version },
                  { onSuccess: () => { setConfirmOpen(false); }, onError: (error) => { setErrorText(describeErrorText(describeError(error, "deleteNotificationRule"))); } },
                );
              }}
              data-testid="rule-delete-confirm"
            >
              {t("common.delete")}
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const EMPTY_RULE: NotificationRuleWrite = {
  name: "",
  enabled: false,
  flow_id: null,
  event_type: "change_order.submitted",
  target_kind: "order_submitter",
  channel_id: "",
};

function RuleFormDialog({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: NotificationRule | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createRule = useCreateNotificationRule();
  const replaceRule = useReplaceNotificationRule();
  const previewRule = usePreviewNotificationRule();
  const channelsQuery = useNotificationChannels(true, { limit: 100 });
  const flowsQuery = useFlows(true);
  const flows = flowsQuery.data?.items ?? [];
  const channels = channelsQuery.data?.items ?? [];
  const [draft, setDraft] = useState<NotificationRuleWrite>(EMPTY_RULE);
  // 无初值时落到首个渠道（Base UI Select要求受控值命中items）。
  const firstChannel = channels[0];
  if (draft.channel_id === "" && firstChannel !== undefined) {
    setDraft({ ...draft, channel_id: firstChannel.id });
  }
  const [sampleOrder, setSampleOrder] = useState("");
  const [preview, setPreview] = useState<NotificationRulePreview | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const formKey = editing?.id ?? "create";
  if (open && openFor !== formKey) {
    setOpenFor(formKey);
    setErrorText(null);
    setPreview(null);
    setSampleOrder("");
    setDraft(
      editing === null
        ? EMPTY_RULE
        : {
            name: editing.name,
            enabled: editing.enabled,
            flow_id: editing.flow_id,
            event_type: editing.event_type,
            target_kind: editing.target_kind,
            channel_id: editing.channel_id,
          },
    );
  }
  if (!open && openFor !== null) setOpenFor(null);

  const runPreview = async () => {
    setErrorText(null);
    try {
      const result = await previewRule.mutateAsync({
        rule: draft,
        sample_order_id: sampleOrder === "" ? null : sampleOrder,
      });
      setPreview(result);
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "previewNotificationRule")));
    }
  };

  const submit = async () => {
    setErrorText(null);
    try {
      if (editing === null) {
        await createRule.mutateAsync(draft);
      } else {
        await replaceRule.mutateAsync({ ruleId: editing.id, version: editing.version, body: draft });
      }
      onClose();
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, editing === null ? "createNotificationRule" : "replaceNotificationRule")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing === null ? t("adminRules.createTitle") : t("adminRules.editTitle", { name: editing.name })}</DialogTitle>
          <DialogDescription>{t("adminRules.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-name">{t("adminRules.column.name")}</Label>
            <Input id="rule-name" value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); }} maxLength={128} data-testid="rule-name" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="rule-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => { setDraft({ ...draft, enabled: checked }); }}
              data-testid="rule-enabled"
            />
            <Label htmlFor="rule-enabled" className="cursor-pointer">
              {t("adminRules.column.enabled")}
            </Label>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-event">{t("adminRules.column.event")}</Label>
            <Select
              value={draft.event_type}
              onValueChange={(value) => { setDraft({ ...draft, event_type: value as NotificationRuleEventType }); }}
            >
              <SelectTrigger id="rule-event" className="w-full" data-testid="rule-event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((eventType) => (
                  <SelectItem key={eventType} value={eventType}>
                    {t(`adminRules.event.${eventType}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-flow">{t("adminRules.column.flow")}</Label>
            <Select
              value={draft.flow_id ?? ""}
              onValueChange={(value) => { setDraft({ ...draft, flow_id: value === "" ? null : value }); }}
            >
              <SelectTrigger id="rule-flow" className="w-full" data-testid="rule-flow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("adminRules.flow.all")}</SelectItem>
                {flows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>
                    {flow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-target">{t("adminRules.column.target")}</Label>
            <Select
              value={draft.target_kind}
              onValueChange={(value) => { setDraft({ ...draft, target_kind: value as NotificationRuleTargetKind }); }}
            >
              <SelectTrigger id="rule-target" className="w-full" data-testid="rule-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_KINDS.map((targetKind) => (
                  <SelectItem key={targetKind} value={targetKind}>
                    {t(`adminRules.target.${targetKind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-channel">{t("adminRules.column.channel")}</Label>
            <Select
              value={draft.channel_id}
              onValueChange={(value) => { if (value !== null) { setDraft({ ...draft, channel_id: value }); } }}
            >
              <SelectTrigger id="rule-channel" className="w-full" data-testid="rule-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.name} ({channel.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">{t("adminRules.previewTitle")}</p>
            <p className="text-muted-foreground mt-1 text-xs">{t("adminRules.previewDescription")}</p>
            <div className="mt-2 flex gap-2">
              <Input
                placeholder={t("adminRules.previewSamplePlaceholder")}
                value={sampleOrder}
                onChange={(event) => { setSampleOrder(event.target.value); }}
                data-testid="rule-preview-sample"
              />
              <Button variant="outline" onClick={() => { void runPreview(); }} data-testid="rule-preview-run">
                <Eye />
                {t("adminRules.previewRun")}
              </Button>
            </div>
            {preview !== null && (
              <div className="mt-2" data-testid="rule-preview-result">
                <p className="text-xs text-muted-foreground">
                  {t("adminRules.previewTargets", { count: preview.targets.length })}
                </p>
                <ul className="mt-1 font-mono text-xs">
                  {preview.targets.map((target) => (
                    <li key={target.recipient_key}>
                      {target.recipient_key}
                      {target.masked_address ? ` · ${target.masked_address}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 rounded bg-muted p-2 text-xs whitespace-pre-wrap">{preview.message_preview}</p>
              </div>
            )}
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="rule-form-error">
              <AlertTitle>{t("adminRules.formFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <PendingButton
            pending={createRule.isPending || replaceRule.isPending}
            disabled={draft.name.trim() === "" || draft.channel_id === ""}
            onClick={() => { void submit(); }}
            data-testid="rule-form-submit"
          >
            {t("common.save")}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
