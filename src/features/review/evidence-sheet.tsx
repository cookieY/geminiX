import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ReviewFinding, ReviewEvidence } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import {
  listReviewFindingEvidence,
  recordRawReviewEvidenceCopy,
  revealRawReviewEvidence,
} from "@/api/generated/client/change-orders/change-orders";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { ClipboardCopy, Eye, ShieldAlert } from "lucide-react";
import { describeError } from "@/shared/api/error-display";

/**
 * Evidence sheet (migration contract §4 item 6, §6 sensitive-data boundary):
 * normalized evidence always renders; the Raw Payload is a separate explicit
 * reveal that is re-authorized per view, watermarked server-side, kept in
 * memory only (no web storage, no telemetry) and copied solely through the
 * copy-audit API. The 7-day retention countdown is shown while the raw
 * payload exists; after expiry only normalized evidence remains.
 */

interface EvidenceSheetProps {
  finding: ReviewFinding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RevealedRaw {
  text: string;
  revealId: string;
  watermark: string;
}

export function EvidenceSheet({ finding, open, onOpenChange }: EvidenceSheetProps) {
  const { t } = useTranslation();

  const evidenceQuery = useQuery({
    queryKey: ["review-finding-evidence", finding?.id],
    queryFn: async () =>
      (await listReviewFindingEvidence(finding?.id as string)) as unknown as ReviewEvidence[],
    enabled: open && finding !== null,
  });
  const evidence: ReviewEvidence[] = evidenceQuery.data ?? [];

  const [revealed, setRevealed] = useState<Record<string, RevealedRaw>>({});

  // Plaintext lives in component memory only: closing the sheet wipes every
  // revealed raw payload (migration contract §6); unmount does the same via
  // the cleanup-only effect below.
  const handleOpenChange = (next: boolean) => {
    if (!next) setRevealed({});
    onOpenChange(next);
  };
  useEffect(() => () => {
    setRevealed({});
  }, []);

  const revealMutation = useMutation({
    mutationFn: (evidenceId: string) =>
      revealRawReviewEvidence(evidenceId, { purpose: "review-evidence" }),
    onSuccess: (data, evidenceId) => {
      const payload = data as unknown as {
        raw_payload: unknown;
        watermark: string;
        reveal_id: string;
      };
      setRevealed((previous) => ({
        ...previous,
        [evidenceId]: {
          text: JSON.stringify(payload.raw_payload, null, 2),
          revealId: payload.reveal_id,
          watermark: payload.watermark,
        },
      }));
    },
  });

  const copyMutation = useMutation({
    mutationFn: (input: { evidenceId: string; revealId: string }) =>
      recordRawReviewEvidenceCopy(input.evidenceId, { source_reveal_id: input.revealId }),
  });

  const copyRevealed = (evidenceId: string) => {
    const revealedRaw = revealed[evidenceId];
    if (revealedRaw === undefined) return;
    // The independent audit API call is initiated before any clipboard write
    // (migration contract §6) — the audit request is ordered first and the
    // record is persisted server-side. The write is issued in the same
    // user-activation window: awaiting the audit response first lets
    // Chromium's transient activation expire and silently drops the copy.
    const audit = copyMutation
      .mutateAsync({ evidenceId, revealId: revealedRaw.revealId })
      .then(() => true)
      .catch(() => false);
    const write = navigator.clipboard
      .writeText(revealedRaw.text)
      .then(() => true)
      .catch(() => false);
    void Promise.all([audit, write]);
  };

  // Each query/mutation is judged by its own operation error profile.
  const errorDisplay =
    revealMutation.error !== null
      ? describeError(revealMutation.error, "revealRawReviewEvidence")
      : evidenceQuery.error !== null
        ? describeError(evidenceQuery.error, "listReviewFindingEvidence")
        : null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg" data-testid="evidence-sheet">
        <SheetHeader>
          <SheetTitle>{t("precheck.evidence.title")}</SheetTitle>
          <SheetDescription>{t("precheck.evidence.description")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-8" data-testid="evidence-content">
          {errorDisplay !== null && (
            <p role="alert" className="text-destructive text-sm">
              {t(errorDisplay.messageKey)}
              {errorDisplay.requestId !== null ? ` (${errorDisplay.requestId})` : ""}
            </p>
          )}
          {evidence.length === 0 && evidenceQuery.isSuccess && (
            <p className="text-muted-foreground text-sm">{t("precheck.evidence.empty")}</p>
          )}
          {evidence.map((entry) => {
            const revealedRaw = revealed[entry.id];
            const expiresAt = entry.raw_payload_expires_at;
            return (
              <section
                key={entry.id}
                className="rounded-md border p-3 text-sm"
                data-testid="evidence-item"
              >
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{entry.source_reference}</span>
                  <span className="text-muted-foreground text-xs">
                    {t(`precheck.evidence.fact.${entry.fact_status}`)}
                  </span>
                </header>
                <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-2 text-xs">
                  {JSON.stringify(entry.normalized_fact, null, 2)}
                </pre>
                {entry.has_raw_payload && expiresAt != null && (
                  <footer className="mt-2 space-y-2">
                    <p className="text-muted-foreground text-xs">
                      {t("precheck.evidence.retention", {
                        days: remainingDays(expiresAt),
                      })}
                    </p>
                    {revealedRaw === undefined ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { revealMutation.mutate(entry.id); }}
                        disabled={revealMutation.isPending}
                        data-testid={`reveal-raw-${entry.id}`}
                      >
                        <Eye className="size-3.5" aria-hidden />
                        {t("precheck.evidence.reveal")}
                      </Button>
                    ) : (
                      <div className="space-y-2" data-testid={`raw-view-${entry.id}`}>
                        <p className="text-muted-foreground flex items-center gap-1 text-xs">
                          <ShieldAlert className="size-3.5" aria-hidden />
                          {revealedRaw.watermark}
                        </p>
                        <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs">
                          {revealedRaw.text}
                        </pre>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            copyRevealed(entry.id);
                          }}
                          data-testid={`copy-raw-${entry.id}`}
                        >
                          <ClipboardCopy className="size-3.5" aria-hidden />
                          {t("precheck.evidence.copy")}
                        </Button>
                      </div>
                    )}
                  </footer>
                )}
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function remainingDays(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 3600 * 1000)));
}
