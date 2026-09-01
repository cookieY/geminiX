import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Megaphone, Plus } from "lucide-react";
import type { AnnouncementRevision } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { useAnnouncementRevisions, useCreateAnnouncementRevision, usePublishAnnouncement } from "@/features/admin/use-admin";
import { useCurrentAnnouncementQuery } from "@/routes/workspace/workspace-dashboard-sections";

/**
 * 公告管理 (route /admin/announcements; UI spec §9.2 ruling keeps it
 * independent of /admin/settings/branding). S005: revisions are sanitized
 * append-only — the editor only takes title + restricted Markdown source,
 * the server sanitizes to HTML (rendered verbatim by the workspace banner);
 * publishing moves the single current pointer. No editing or deleting of
 * existing revisions exists by contract.
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

export default function AdminAnnouncementsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const revisionsQuery = useAnnouncementRevisions(isAdmin);
  const currentQuery = useCurrentAnnouncementQuery(isAdmin);
  const createRevision = useCreateAnnouncementRevision();
  const publish = usePublishAnnouncement();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const revisions = revisionsQuery.data ?? [];
  const current = currentQuery.data ?? null;

  const submitCreate = async () => {
    setErrorText(null);
    try {
      await createRevision.mutateAsync({ title, markdown_source: markdown });
      setTitle("");
      setMarkdown("");
      setCreateOpen(false);
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "createAnnouncementRevision")));
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="admin-announcements-page">
      <PageBreadcrumb title={t("nav.admin.announcements")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminAnnouncements.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("adminAnnouncements.description")}</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); }} data-testid="admin-announcements-create">
          <Plus />
          {t("adminAnnouncements.create")}
        </Button>
      </header>

      {current !== null && (
        <Card data-testid="admin-announcements-current">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Megaphone className="size-4" />
              {t("adminAnnouncements.current")}
            </CardTitle>
            <CardDescription>
              {t("adminAnnouncements.currentMeta", {
                revision: current.revision.revision_number,
                at: current.published_at.replace("T", " ").replace("Z", " UTC"),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: current.revision.sanitized_html }}
            />
          </CardContent>
        </Card>
      )}

      {revisionsQuery.isPending && <LoadingState />}
      {revisionsQuery.error !== null && (
        <ErrorState error={revisionsQuery.error} operationId="listAnnouncementRevisions" onRetry={() => void revisionsQuery.refetch()} />
      )}

      {!revisionsQuery.isPending && revisionsQuery.error === null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("adminAnnouncements.revisions")}</CardTitle>
            <CardDescription>{t("adminAnnouncements.revisionsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {revisions.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-announcements-empty">
                {t("adminAnnouncements.empty")}
              </p>
            ) : (
              <Table data-testid="admin-announcements-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t("adminAnnouncements.column.title")}</TableHead>
                    <TableHead>{t("adminAnnouncements.column.createdAt")}</TableHead>
                    <TableHead>{t("adminAnnouncements.column.hash")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((revision: AnnouncementRevision) => (
                    <TableRow key={revision.id} data-testid={`admin-announcement-row-${revision.id}`}>
                      <TableCell className="tabular-nums">{revision.revision_number}</TableCell>
                      <TableCell>{revision.title}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {revision.created_at.replace("T", " ").replace("Z", " UTC")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {revision.content_sha256.slice(0, 12)}…
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            current?.revision.id === revision.id ||
                            publish.isPending
                          }
                          onClick={() => {
                            setErrorText(null);
                            publish.mutate(
                              {
                                body: { announcement_revision_id: revision.id },
                                publicationVersion: current?.version ?? 1,
                              },
                              {
                                onError: (error) => { setErrorText(
                                    describeErrorText(describeError(error, "publishAnnouncementRevision")),
                                  ); },
                              },
                            );
                          }}
                          data-testid={`admin-announcement-publish-${revision.id}`}
                        >
                          {current?.revision.id === revision.id ? t("adminAnnouncements.published") : t("adminAnnouncements.publish")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {errorText !== null && (
        <Alert variant="destructive" data-testid="admin-announcements-error">
          <AlertTitle>{t("adminAnnouncements.operationFailed")}</AlertTitle>
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      )}

      <Dialog open={createOpen} onOpenChange={(next) => { if (!next) setCreateOpen(false); }}>
        <DialogContent data-testid="admin-announcement-create-dialog">
          <DialogHeader>
            <DialogTitle>{t("adminAnnouncements.createTitle")}</DialogTitle>
            <DialogDescription>{t("adminAnnouncements.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="announcement-title">{t("adminAnnouncements.column.title")}</Label>
              <Input
                id="announcement-title"
                value={title}
                onChange={(event) => { setTitle(event.target.value); }}
                maxLength={200}
                data-testid="announcement-title"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="announcement-markdown">{t("adminAnnouncements.markdown")}</Label>
              <Textarea
                id="announcement-markdown"
                value={markdown}
                onChange={(event) => { setMarkdown(event.target.value); }}
                className="min-h-32"
                maxLength={20000}
                data-testid="announcement-markdown"
              />
              <p className="text-muted-foreground text-xs">{t("adminAnnouncements.markdownHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={title.trim() === "" || markdown.trim() === "" || createRevision.isPending}
              onClick={() => void submitCreate()}
              data-testid="announcement-create-submit"
            >
              {createRevision.isPending ? t("common.saving") : t("adminAnnouncements.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
