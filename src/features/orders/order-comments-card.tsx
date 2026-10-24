import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateOrderComment, useOrderComments } from "@/features/orders/use-approvals";
import { describeError } from "@/shared/api/error-display";
import { PendingButton } from "@/shared/components/pending-button";
import { ErrorState } from "@/shared/components/status/status-components";
import { LoadingState } from "@/shared/components/status/loading-state";
import { EmptyState } from "@/shared/components/status/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Textarea } from "@/shared/components/ui/textarea";
import { MessageSquare } from "lucide-react";

/**
 * Order comments (legacy orderProfile comment tab continuity; S004 permanent
 * retention). Append-only: no edit or delete affordance exists anywhere on
 * the contract surface. Errors render inline through the operation's own
 * error profile — never a fake success.
 */
export function OrderCommentsCard({ orderId }: { orderId: string }) {
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
    <Card data-testid="order-comments">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4" aria-hidden />
          {t("orders.detail.comments")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
          <ol className="flex flex-col gap-3" data-testid="order-comments-list">
            {commentsQuery.data.map((comment) => (
              <li key={comment.id} className="rounded-md border p-3 text-sm" data-testid="order-comment-item">
                <p className="text-muted-foreground text-xs">
                  {comment.author_display_name} · {comment.occurred_at.replace("T", " ").replace("Z", " UTC")}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{comment.content}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
