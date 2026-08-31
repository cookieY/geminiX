import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecordOrderSqlCopy, useRevealOrderSql, type OrderSqlReveal } from "@/features/orders/use-approvals";
import { describeError } from "@/shared/api/error-display";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Spinner } from "@/shared/components/ui/spinner";
import { ClipboardCopy, Eye, FileCode2, ShieldAlert } from "lucide-react";

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
    // The audit request is ordered before the clipboard write (migration
    // contract §6); awaiting it first would let the transient activation
    // expire, so both run in the same activation window.
    const audit = copyAudit
      .mutateAsync(revealed.revealId)
      .then(() => true)
      .catch(() => false);
    const write = navigator.clipboard
      .writeText(revealed.sql)
      .then(() => true)
      .catch(() => false);
    void Promise.all([audit, write]);
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
            <pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 font-mono text-xs">
              {revealed.sql}
            </pre>
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
