import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChangeOrder, ChangeOrderTimelineEntry } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useCreateOrderComment, useOrderComments } from "@/features/orders/use-approvals";
import { useChangeOrderTimeline } from "@/features/orders/use-orders";
import { describeError } from "@/shared/api/error-display";
import { PendingButton } from "@/shared/components/pending-button";
import { EmptyState } from "@/shared/components/status/empty-state";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import {
  CalendarCheck,
  CalendarClock,
  Fingerprint,
  Flag,
  Hash,
  ShieldCheck,
  User,
  UserCheck,
  Wrench,
} from "lucide-react";

/**
 * Order activity card: the timeline, the comments and the frozen snapshot of
 * one order in a single card, switched by a segmented tab bar. Layout after the
 * "Upcoming Schedules" card the owner picked as reference (Shadcn Dashboard
 * Card 33 is a PRO block, so it is rebuilt from the free primitives): title
 * and subtitle, a full-width tab track whose active pill is bordered, then
 * rows of an icon tile + muted label over a bold value, with a badge on the
 * right. All three panels stay mounted — a half-written comment survives a
 * tab switch and every query is warm before its tab is opened.
 */

export function formatTimestamp(value: string | null | undefined): string {
  return value === null || value === undefined ? "—" : value.replace("T", " ").replace("Z", " UTC");
}

const STATE_LABEL_ROOTS = ["orders.state", "orders.stageState"] as const;

/** Timeline entry states mix order and stage enums; resolve the localized
 * label from either dictionary and fall back to the raw value. */
function useTimelineStateLabel(): (state: string | null | undefined) => string {
  const { t, i18n } = useTranslation();
  return (state): string => {
    if (state === null || state === undefined) return "";
    for (const root of STATE_LABEL_ROOTS) {
      const key = `${root}.${state}`;
      if (i18n.exists(key)) return t(key);
    }
    return state;
  };
}

function ActorIcon({ kind }: { kind: ChangeOrderTimelineEntry["actor_kind"] }) {
  if (kind === "user") return <User aria-hidden />;
  if (kind === "system") return <ShieldCheck aria-hidden />;
  return <Wrench aria-hidden />;
}

/** One row: bordered icon tile, muted label over a bold value, optional
 * trailing badge and body. */
function ActivityRow({
  icon,
  label,
  value,
  mono = false,
  strong = true,
  aside,
  children,
  ...props
}: {
  icon: ReactNode;
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  strong?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <li className="flex items-start gap-3" {...props}>
      <span className="bg-muted/30 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-sm leading-snug">{label}</p>
        <p
          className={cn(
            "text-sm leading-snug whitespace-pre-wrap",
            strong && "font-semibold",
            mono ? "font-mono text-xs break-all" : "break-words",
          )}
        >
          {value}
        </p>
        {children}
      </div>
      {aside}
    </li>
  );
}

function TimelinePanel({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const stateLabel = useTimelineStateLabel();
  const timelineQuery = useChangeOrderTimeline(orderId, true);
  const entries = timelineQuery.data ?? [];

  return (
    <div data-testid="order-timeline">
      {timelineQuery.isPending ? (
        <LoadingState variant="table" columns={2} />
      ) : timelineQuery.isError ? (
        <ErrorState
          error={timelineQuery.error}
          operationId="listChangeOrderTimeline"
          onRetry={() => void timelineQuery.refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyState title={t("orders.detail.timelineEmpty")} />
      ) : (
        <ol className="flex flex-col gap-4" data-testid="order-timeline-list">
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              icon={<ActorIcon kind={entry.actor_kind} />}
              label={
                <>
                  {formatTimestamp(entry.occurred_at)}
                  {entry.stage_position !== null && (
                    <> · {t("orders.detail.timelineStage", { position: entry.stage_position })}</>
                  )}
                </>
              }
              value={entry.summary}
              aside={
                entry.state !== null ? (
                  <Badge variant="outline" className="shrink-0">
                    {stateLabel(entry.state)}
                  </Badge>
                ) : undefined
              }
            >
              {entry.comment != null && entry.comment !== "" && (
                <p
                  className="text-foreground/80 mt-1 text-xs break-words whitespace-pre-wrap"
                  data-testid="order-timeline-comment"
                >
                  {entry.comment}
                </p>
              )}
            </ActivityRow>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Order comments (S004 permanent retention). Append-only: no edit or delete
 * affordance exists anywhere on the contract surface. Errors render inline
 * through the operation's own error profile — never a fake success. */
function CommentsPanel({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const commentsQuery = useOrderComments(orderId, true);
  const createComment = useCreateOrderComment(orderId);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    createComment.mutate(content, {
      onSuccess: () => {
        setContent("");
        setError(null);
      },
      onError: (mutationError) => {
        const display = describeError(mutationError, "createChangeOrderComment");
        setError(
          `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="order-comments">
      <div className="flex flex-col gap-2">
        <Textarea
          value={content}
          onChange={(event) => { setContent(event.target.value); }}
          rows={2}
          maxLength={4096}
          placeholder={t("orders.detail.commentPlaceholder")}
          data-testid="order-comment-input"
        />
        <div className="flex items-center gap-3">
          <PendingButton
            size="sm"
            onClick={submit}
            pending={createComment.isPending}
            disabled={content.trim() === ""}
            data-testid="order-comment-submit"
          >
            {t("orders.detail.commentSubmit")}
          </PendingButton>
          {error !== null && (
            <p role="alert" className="text-destructive text-xs" data-testid="order-comment-error">
              {error}
            </p>
          )}
        </div>
      </div>
      {commentsQuery.isPending ? (
        <LoadingState variant="inline" />
      ) : commentsQuery.isError ? (
        <ErrorState
          error={commentsQuery.error}
          operationId="listChangeOrderComments"
          onRetry={() => void commentsQuery.refetch()}
        />
      ) : commentsQuery.data.length === 0 ? (
        <EmptyState title={t("orders.detail.commentsEmpty")} testId="order-comments-empty" />
      ) : (
        <ol className="flex flex-col gap-4" data-testid="order-comments-list">
          {commentsQuery.data.map((comment) => (
            <ActivityRow
              key={comment.id}
              icon={<User aria-hidden />}
              label={`${comment.author_display_name} · ${formatTimestamp(comment.occurred_at)}`}
              value={comment.content}
              strong={false}
              data-testid="order-comment-item"
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function SnapshotPanel({ order }: { order: ChangeOrder }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4" data-testid="order-facts">
      <ul className="flex flex-col gap-4">
        <ActivityRow
          icon={<CalendarClock aria-hidden />}
          label={t("orders.detail.submittedAt")}
          value={formatTimestamp(order.submitted_at)}
        />
        {order.requested_scheduled_for != null && (
          <ActivityRow
            icon={<CalendarCheck aria-hidden />}
            label={t("orders.detail.requestedSchedule")}
            value={formatTimestamp(order.requested_scheduled_for)}
            data-testid="order-requested-schedule"
          />
        )}
        <ActivityRow
          icon={<Flag aria-hidden />}
          label={t("orders.detail.terminalAt")}
          value={formatTimestamp(order.terminal_at)}
        />
        <ActivityRow
          icon={<UserCheck aria-hidden />}
          label={t("orders.detail.manuallyVerified")}
          value={order.manually_verified ? t("common.yes") : t("common.no")}
        />
        <ActivityRow icon={<Hash aria-hidden />} label={t("orders.detail.sqlHash")} value={order.sql_hash} mono />
        <ActivityRow
          icon={<Fingerprint aria-hidden />}
          label={t("orders.detail.snapshotHash")}
          value={order.snapshot_hash}
          mono
        />
      </ul>
      <p className="text-muted-foreground text-xs">{t("orders.detail.frozenNote")}</p>
    </div>
  );
}

export function OrderActivityCard({ order }: { order: ChangeOrder }) {
  const { t } = useTranslation();
  return (
    <Card data-testid="order-activity">
      <CardHeader>
        <CardTitle>{t("orders.detail.activity")}</CardTitle>
        <CardDescription>{t("orders.detail.activityHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="timeline" className="gap-5">
          <TabsList className="bg-muted/60 h-auto w-full gap-0 rounded-lg p-1">
            {(["timeline", "comments", "snapshot"] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-8 flex-1 rounded-md data-active:border-border data-active:bg-background data-active:text-foreground data-active:hover:bg-background data-active:hover:text-foreground dark:data-active:bg-background dark:data-active:text-foreground"
                data-testid={`order-activity-tab-${tab}`}
              >
                {t(
                  tab === "timeline"
                    ? "orders.detail.timeline"
                    : tab === "comments"
                      ? "orders.detail.comments"
                      : "orders.detail.facts",
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="timeline" keepMounted className="text-sm">
            <TimelinePanel orderId={order.id} />
          </TabsContent>
          <TabsContent value="comments" keepMounted className="text-sm">
            <CommentsPanel orderId={order.id} />
          </TabsContent>
          <TabsContent value="snapshot" keepMounted className="text-sm">
            <SnapshotPanel order={order} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
