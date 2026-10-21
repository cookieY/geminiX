import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordOrderSqlCopy, useRevealOrderSql, type OrderSqlReveal } from "@/features/orders/use-approvals";
import { describeError } from "@/shared/api/error-display";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Spinner } from "@/shared/components/ui/spinner";
import { ClipboardCopy, Eye, FileCode2, ShieldAlert } from "lucide-react";

// §18.45: the revealed plaintext renders in the read-only Monaco viewer —
// SQL highlighting plus line numbers/folding for bulk statements inside the
// hard height cap. Lazily imported so an unrevealed detail page never
// downloads the editor chunk at all.
const SqlReadOnlyViewer = lazy(() =>
  import("@/features/review/sql-editor-panel").then((module) => ({ default: module.SqlReadOnlyViewer })),
);

/**
 * Frozen SQL Revision viewer (PRD F7 item 1 — the reviewer judges the exact
 * SQL the submission froze). The plaintext never lives in the contract
 * surface (the order carries sql_hash only): every view is an explicit,
 * per-view authorized reveal (sensitive_reveal profile), watermarked with
 * the viewer and server time, valid for five minutes. Plaintext stays in
 * component memory only — closing the viewer or unmounting wipes it (no web
 * storage, no telemetry); copying goes through the audited copy-event API
 * before the clipboard write, mirroring the draft-side reveal contract.
 */
export function OrderSqlCard({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const reveal = useRevealOrderSql(orderId);
  const copyAudit = useRecordOrderSqlCopy(orderId);
  const [revealed, setRevealed] = useState<OrderSqlReveal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plaintext lives in component memory only: unmount wipes the reveal.
  useEffect(() => () => { setRevealed(null); }, []);

  const revealNow = (): void => {
    reveal.mutate("review-order-sql", {
      onSuccess: (data) => {
        setRevealed(data);
        setError(null);
      },
      onError: (revealError) => {
        const display = describeError(revealError, "revealOrderSql");
        setError(
          `${t(display.messageKey)}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
        );
      },
    });
  };

  const closeReveal = (): void => {
    setRevealed(null);
  };

  const copyRevealed = (): void => {
    if (revealed === null) return;
    setError(null);
    // SEC-0035: the clipboard write is issued synchronously inside the click
    // handler — awaiting anything before it would let Chromium's transient
    // activation expire and silently drop the copy. The audit request fires
    // only after the plaintext actually reached the clipboard, and every
    // failure surfaces through the inline error alert (nothing is swallowed):
    // an unrecorded audit must never pass silently after a real copy.
    void navigator.clipboard
      .writeText(revealed.sql)
      .then(() =>
        copyAudit.mutateAsync(revealed.revealId).catch((auditError: unknown) => {
          const display = describeError(auditError, "recordOrderSqlCopy");
          setError(
            `${t("orders.sql.copyAuditFailed", { detail: t(display.messageKey) })}${display.requestId !== null ? ` (${display.requestId})` : ""}`,
          );
        }),
      )
      .catch(() => {
        setError(t("orders.sql.copyFailed"));
      });
  };

  return (
    <Card data-testid="order-sql-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileCode2 className="size-4" aria-hidden />
          {t("orders.sql.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error !== null && (
          <p role="alert" className="text-destructive text-xs" data-testid="order-sql-error">
            {error}
          </p>
        )}
        {revealed === null ? (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={revealNow}
              disabled={reveal.isPending}
              data-testid="reveal-order-sql"
            >
              {reveal.isPending && <Spinner className="size-3.5" />}
              <Eye className="size-3.5" aria-hidden />
              {t("orders.sql.reveal")}
            </Button>
            <p className="text-muted-foreground text-xs">{t("orders.sql.revealNote")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-testid="order-sql-view">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <ShieldAlert className="size-3.5" aria-hidden />
              {revealed.watermark}
            </p>
            <Suspense
              fallback={
                <div
                  className="bg-muted text-muted-foreground flex h-20 items-center justify-center gap-2 rounded-md border text-xs"
                  data-testid="order-sql-loading"
                >
                  <Spinner className="size-3.5" />
                  {t("orders.sql.loading")}
                </div>
              }
            >
              <SqlReadOnlyViewer value={revealed.sql} data-testid="order-sql-readonly" />
            </Suspense>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={copyRevealed} data-testid="copy-order-sql">
                <ClipboardCopy className="size-3.5" aria-hidden />
                {t("orders.sql.copy")}
              </Button>
              <Button variant="ghost" size="sm" onClick={closeReveal} data-testid="close-order-sql">
                {t("orders.sql.close")}
              </Button>
              <span className="text-muted-foreground text-xs">
                {t("orders.sql.validUntil", { time: revealed.validUntil.replace("T", " ").replace("Z", " UTC") })}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
