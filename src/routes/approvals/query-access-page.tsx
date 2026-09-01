import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Check, ShieldOff, Stamp, X } from "lucide-react";
import type { QueryAccessRequest, QueryGrant } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { Textarea } from "@/shared/components/ui/textarea";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  useDecideAccessRequest,
  useMyAccessRequests,
  useMyGrants,
  useRevokeGrant,
} from "@/features/query/use-query-domain";

/**
 * 查询访问审批 (route /approvals/query-access; migration contract §2 maps
 * legacy /server/query/list here — "审批数据源访问资格，不审批SQL", Q001).
 * The server scopes listQueryAccessRequests to requester-ownership ∪
 * frozen-reviewer relations, so the pending queue is exactly the
 * access_pending rows of that scoped list — no client-side guessing about
 * reviewer identity. Decisions approve the DATASOURCE ACCESS eligibility
 * (never SQL); final approval creates the grant server-side (Q003).
 *
 * Active grants the current reviewer relation can see carry the revoke
 * action (frozen reviewer or builtin admin, Q004) — revocation is
 * terminating access, never reading it.
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace("Z", " UTC");
}

export default function QueryAccessApprovalsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const authenticated = session.status === "authenticated";
  const requestsQuery = useMyAccessRequests(authenticated);
  const grantsQuery = useMyGrants(authenticated);
  const decide = useDecideAccessRequest();

  const [deciding, setDeciding] = useState<QueryAccessRequest | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [comment, setComment] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const requests = requestsQuery.data ?? [];
  const pending = requests.filter((row) => row.state === "access_pending");
  const grants = grantsQuery.data ?? [];
  const activeGrants = grants.filter((row) => row.state === "active");

  const submitDecision = async () => {
    if (deciding === null) return;
    setErrorText(null);
    try {
      await decide.mutateAsync({
        requestId: deciding.id,
        version: deciding.version,
        body: { decision, comment: comment.trim() === "" ? undefined : comment },
      });
      setDeciding(null);
      setComment("");
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "decideQueryAccess")));
    }
  };

  const loadError = requestsQuery.error ?? grantsQuery.error;

  return (
    <div className="flex flex-col gap-4" data-testid="query-access-approvals">
      <PageBreadcrumb title={t("approvals.title")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("approvals.queryAccess.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("approvals.queryAccess.description")}</p>
        </div>
        <Tabs defaultValue="query-access">
          <TabsList>
            <TabsTrigger
              value="orders"
              onClick={() => { void navigate("/approvals/changes"); }}
              data-testid="approvals-tab-orders"
            >
              {t("approvals.queryAccess.ordersTab")}
            </TabsTrigger>
            <TabsTrigger value="query-access" data-testid="approvals-tab-query">
              {t("approvals.queryAccess.queryTab")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {loadError !== null && (
        <ErrorState
          error={loadError}
          operationId="listQueryAccessRequests"
          onRetry={() => {
            void requestsQuery.refetch();
            void grantsQuery.refetch();
          }}
        />
      )}
      {loadError === null && requestsQuery.isPending && <LoadingState />}

      {loadError === null && !requestsQuery.isPending && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Stamp className="size-4" />
                {t("approvals.queryAccess.pendingCard")}
              </CardTitle>
              <CardDescription>{t("approvals.queryAccess.pendingDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm" data-testid="query-access-pending-empty">
                  {t("approvals.queryAccess.pendingEmpty")}
                </p>
              ) : (
                <Table data-testid="query-access-pending-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("approvals.queryAccess.column.requester")}</TableHead>
                      <TableHead>{t("approvals.queryAccess.column.datasources")}</TableHead>
                      <TableHead>{t("approvals.queryAccess.column.state")}</TableHead>
                      <TableHead>{t("approvals.queryAccess.column.submittedAt")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((row) => (
                      <TableRow key={row.id} data-testid={`query-access-pending-${row.id}`}>
                        <TableCell className="font-mono text-xs">{row.requester_user_id}</TableCell>
                        <TableCell className="max-w-72 truncate font-mono text-xs">
                          {row.datasource_ids.join(" · ")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{t("query.request.state.access_pending")}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {formatTimestamp(row.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDecision("approve");
                                setDeciding(row);
                              }}
                              data-testid={`query-access-approve-${row.id}`}
                            >
                              <Check />
                              {t("approvals.queryAccess.approve")}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                setDecision("reject");
                                setDeciding(row);
                              }}
                              data-testid={`query-access-reject-${row.id}`}
                            >
                              <X />
                              {t("approvals.queryAccess.reject")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <GrantRevocationCard grants={activeGrants} />
        </>
      )}

      <Dialog open={deciding !== null} onOpenChange={(open) => { if (!open) setDeciding(null); }}>
        <DialogContent data-testid="query-access-decision-dialog">
          <DialogHeader>
            <DialogTitle>
              {decision === "approve"
                ? t("approvals.queryAccess.approveTitle")
                : t("approvals.queryAccess.rejectTitle")}
            </DialogTitle>
            <DialogDescription>
              {decision === "approve"
                ? t("approvals.queryAccess.approveDescription")
                : t("approvals.queryAccess.rejectDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="query-access-comment">{t("approvals.queryAccess.comment")}</Label>
            <Textarea
              id="query-access-comment"
              value={comment}
              onChange={(event) => { setComment(event.target.value); }}
              maxLength={4096}
              data-testid="query-access-comment"
            />
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="query-access-decision-error">
              <AlertTitle>{t("approvals.queryAccess.decisionFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeciding(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={decision === "reject" ? "destructive" : "default"}
              disabled={decide.isPending}
              onClick={() => void submitDecision()}
              data-testid="query-access-decision-confirm"
            >
              {decide.isPending
                ? t("common.saving")
                : decision === "approve"
                  ? t("approvals.queryAccess.approve")
                  : t("approvals.queryAccess.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GrantRevocationCard({ grants }: { grants: QueryGrant[] }) {
  const { t } = useTranslation();
  const revoke = useRevokeGrant();
  const [revoking, setRevoking] = useState<QueryGrant | null>(null);
  const [reason, setReason] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const submit = async () => {
    if (revoking === null) return;
    setErrorText(null);
    try {
      await revoke.mutateAsync({ grantId: revoking.id, version: revoking.version, reason });
      setRevoking(null);
      setReason("");
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "revokeQueryGrant")));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldOff className="size-4" />
          {t("approvals.queryAccess.grantsCard")}
        </CardTitle>
        <CardDescription>{t("approvals.queryAccess.grantsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldOff />
              </EmptyMedia>
              <EmptyTitle>{t("approvals.queryAccess.grantsEmpty")}</EmptyTitle>
              <EmptyDescription>{t("approvals.queryAccess.grantsEmptyDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table data-testid="query-access-grants-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("approvals.queryAccess.column.grantOwner")}</TableHead>
                <TableHead>{t("approvals.queryAccess.column.state")}</TableHead>
                <TableHead>{t("approvals.queryAccess.column.expiresAt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id} data-testid={`query-access-grant-${grant.id}`}>
                  <TableCell className="font-mono text-xs">{grant.requester_user_id}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t("query.grant.state.active")}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {grant.expires_at === null || grant.expires_at === undefined
                      ? "—"
                      : formatTimestamp(grant.expires_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setReason("");
                        setRevoking(grant);
                      }}
                      data-testid={`query-access-revoke-${grant.id}`}
                    >
                      {t("approvals.queryAccess.revoke")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent data-testid="query-access-revoke-dialog">
          <DialogHeader>
            <DialogTitle>{t("approvals.queryAccess.revokeTitle")}</DialogTitle>
            <DialogDescription>{t("approvals.queryAccess.revokeDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="query-access-revoke-reason">{t("approvals.queryAccess.revokeReason")}</Label>
            <Textarea
              id="query-access-revoke-reason"
              value={reason}
              onChange={(event) => { setReason(event.target.value); }}
              maxLength={4096}
              data-testid="query-access-revoke-reason"
            />
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="query-access-revoke-error">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevoking(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim() === "" || revoke.isPending}
              onClick={() => void submit()}
              data-testid="query-access-revoke-confirm"
            >
              {revoke.isPending ? t("common.saving") : t("approvals.queryAccess.revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
