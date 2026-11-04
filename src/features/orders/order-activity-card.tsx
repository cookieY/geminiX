import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChangeOrder, ChangeOrderTimelineEntry } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useCreateOrderComment, useOrderComments } from "@/features/orders/use-approvals";
import { useChangeOrderTimeline } from "@/features/orders/use-orders";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { EmptyState } from "@/shared/components/status/empty-state";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/components/ui/input-group";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/shared/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/components/ui/message-scroller";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Spinner } from "@/shared/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  CalendarClock,
  Fingerprint,
  Flag,
  Hash,
  MessageCircleDashed,
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
 *
 * owner page feedback 2026-11-04（固定 380px）：三个 tab 的内容统一固定
 * 高度 380px —— 时间线与冻结快照用 ScrollArea（viewportClassName 落
 * h-[380px]，见 scroll-area.tsx 的说明）内容不足也占满、超出内部滚动；
 * 评论区同为固定 380px 面板（message-scroller 保留官方套件自身的滚动，
 * 见其文件头注释）。
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

/** First grapheme of a display name for the message avatar tile.
 * Intl.Segmenter keeps surrogate pairs and combining marks (CJK extension
 * characters, emoji) intact where spread/split would cut UTF-16 units. */
function avatarInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "?";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value;
  return (first?.segment ?? "?").toUpperCase();
}

/** Order comments (S004 permanent retention). Append-only: no edit or delete
 * affordance exists anywhere on the contract surface. Errors render inline
 * through the operation's own error profile — never a fake success.
 *
 * owner ruling 2026-11-04：评论区改用官方 message / message-scroller 组件 ——
 * 每条评论是一个 message（头像 + 署名行 + 气泡），列表在 message-scroller
 * 里限高（max-h-80）内部滚动、自动跟随最新评论，上翻时出现「回到最新」；
 * 空态同样用 message 组件渲染成一条静默气泡，不再是大块 EmptyState。
 *
 * 评论框同日按 owner page feedback 对齐官方 composer 形态：InputGroup +
 * InputGroupTextarea，block-end addon 右下角是 icon 发送键（Enter 发送、
 * Shift+Enter 换行、IME 组词中不触发），替换旧的 Textarea + 按钮行。
 *
 * 第二轮 feedback（同日）对齐官方 demo 截图：列表与评论框合并为同一个
 * 固定高度（380px，2026-11-04 由 h-140 改为固定像素并统一三个页签）圆角面板，
 * 评论框贴在面板底部；空态改为居中 Empty
 * （图标块 + 标题 + 描述），发送键为圆形实心 icon。
 * 第三轮 feedback（同日）：头像改用全站统一 Avatar 组件（初字母回退）；
 * 每条消息入场带 fade+slide 动效；试过的"+"插入菜单按 owner 要求移除。 */
function CommentsPanel({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const commentsQuery = useOrderComments(orderId, true);
  const createComment = useCreateOrderComment(orderId);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    // Enter-to-send reaches this path even when the button is disabled, so the
    // guard lives here and covers both entry points.
    if (content.trim() === "" || createComment.isPending) return;
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

  const comments = commentsQuery.data ?? [];
  // The read model is newest-first (comments application cursor read); the
  // message flow reads oldest → newest.
  const ordered = [...comments].reverse();

  return (
    <div data-testid="order-comments">
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <div className="bg-card flex h-[380px] flex-col overflow-hidden rounded-xl border border-border">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent
                className={cn(
                  "gap-4 px-(--card-spacing) pt-(--card-spacing) pb-1",
                  comments.length === 0 && "justify-center",
                )}
                data-testid="order-comments-list"
              >
                {commentsQuery.isPending ? (
                  <LoadingState variant="inline" />
                ) : commentsQuery.isError ? (
                  <ErrorState
                    error={commentsQuery.error}
                    operationId="listChangeOrderComments"
                    onRetry={() => void commentsQuery.refetch()}
                  />
                ) : comments.length === 0 ? (
                  <Empty data-testid="order-comments-empty">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageCircleDashed aria-hidden />
                      </EmptyMedia>
                      <EmptyTitle>{t("orders.detail.commentsEmpty")}</EmptyTitle>
                      <EmptyDescription>{t("orders.detail.commentsEmptyHint")}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  ordered.map((comment) => {
                    // Chat layout (owner page feedback 2026-11-04): other
                    // people's comments sit left in the neutral bubble, the
                    // author's own sit right in the --comment-own blue.
                    const own = comment.author_user_id === session.user?.id;
                    return (
                      <MessageScrollerItem
                        key={comment.id}
                        messageId={comment.id}
                        className="[content-visibility:visible]"
                      >
                        <Message
                          align={own ? "end" : "start"}
                          data-testid="order-comment-item"
                          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out"
                        >
                          <Avatar className="self-start">
                            <AvatarFallback className="text-xs font-medium">
                              {avatarInitial(comment.author_display_name)}
                            </AvatarFallback>
                          </Avatar>
                          <MessageContent>
                            <MessageHeader className="gap-2 px-0">
                              <span className="font-medium text-foreground">
                                {comment.author_display_name}
                              </span>
                              <span className="text-muted-foreground/70">
                                {formatTimestamp(comment.occurred_at)}
                              </span>
                            </MessageHeader>
                            <p
                              className={cn(
                                "w-fit max-w-full rounded-lg px-3 py-2 text-xs break-words whitespace-pre-wrap",
                                own ? "self-end bg-comment-own text-white" : "self-start bg-muted",
                              )}
                            >
                              {comment.content}
                            </p>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton direction="end">
              <ArrowDown className="size-4" aria-hidden="true" />
              <span className="sr-only">{t("orders.detail.commentsScrollEnd")}</span>
            </MessageScrollerButton>
          </MessageScroller>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="flex flex-col gap-2 p-(--card-spacing) pt-0"
          >
            <InputGroup>
              <InputGroupTextarea
                value={content}
                onChange={(event) => { setContent(event.target.value); }}
                onKeyDown={(event) => {
                  // Chat-style: Enter sends, Shift+Enter breaks a line; a pending
                  // IME composition must not fire the submit.
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                maxLength={4096}
                placeholder={t("orders.detail.commentPlaceholder")}
                aria-label={t("orders.detail.commentPlaceholder")}
                className="min-h-14 max-h-40 overflow-y-auto"
                data-testid="order-comment-input"
              />
              <InputGroupAddon align="block-end" className="pt-1">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={content.trim() === "" || createComment.isPending}
                  aria-busy={createComment.isPending || undefined}
                  className="ml-auto rounded-full"
                  data-testid="order-comment-submit"
                >
                  {createComment.isPending ? <Spinner aria-hidden /> : <ArrowUp aria-hidden />}
                  <span className="sr-only">{t("orders.detail.commentSubmit")}</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {error !== null && (
              <p role="alert" className="text-destructive text-xs" data-testid="order-comment-error">
                {error}
              </p>
            )}
          </form>
        </div>
      </MessageScrollerProvider>
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
            <ScrollArea viewportClassName="h-[380px]" data-testid="order-timeline-scroll">
              <TimelinePanel orderId={order.id} />
            </ScrollArea>
          </TabsContent>
          <TabsContent value="comments" keepMounted className="text-sm">
            <CommentsPanel orderId={order.id} />
          </TabsContent>
          <TabsContent value="snapshot" keepMounted className="text-sm">
            <ScrollArea viewportClassName="h-[380px]" data-testid="order-facts-scroll">
              <SnapshotPanel order={order} />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
