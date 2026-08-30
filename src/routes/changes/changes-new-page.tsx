import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createChangeDraft } from "@/api/generated/client/change-drafts/change-drafts";
import type { Flow } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { StagePath } from "@/features/review/stage-path";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { describeError } from "@/shared/api/error-display";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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
import { Textarea } from "@/shared/components/ui/textarea";
import { FilePlus2, Layers } from "lucide-react";
import { useCurrentUserChangeFlows } from "@/features/review/use-draft-workspace";

/**
 * Change submission entry (route /changes/new, migration contract §2): the
 * old environment/datasource card entry is replaced by review-flow cards —
 * the user picks one of the flows their permission groups grant, sees the
 * frozen stage chain, and creates a draft that inherits it. Stage
 * datasources, approvers and executors stay read-only from here on; the
 * submitter never picks them in the workspace.
 */

export default function ChangesNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const flowsQuery = useCurrentUserChangeFlows();
  const [selected, setSelected] = useState<Flow | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createChangeDraft({
        flow_id: selected?.id as string,
        title,
        description: description === "" ? undefined : description,
      }),
    onSuccess: (draft) => {
      const created = draft as unknown as { id: string };
      void navigate(`/changes/drafts/${created.id}`);
    },
  });

  const flows = flowsQuery.data;
  const errorDisplay =
    flowsQuery.error !== null
      ? describeError(flowsQuery.error, "listCurrentUserFlows")
      : createMutation.error !== null
        ? describeError(createMutation.error, "createChangeDraft")
        : null;

  return (
    <div className="flex flex-col gap-6" data-testid="changes-new-page">
      <PageBreadcrumb title={t("nav.orderSubmit")} />
      <header>
        <h1 className="text-2xl font-semibold">{t("precheck.new.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("precheck.new.description")}</p>
      </header>

      {errorDisplay !== null && (
        <p role="alert" className="text-destructive text-sm">
          {t(errorDisplay.messageKey)}
          {errorDisplay.requestId !== null ? ` (${errorDisplay.requestId})` : ""}
        </p>
      )}

      {flowsQuery.isPending && <LoadingState />}
      {flowsQuery.isError && (
        <ErrorState
          error={flowsQuery.error}
          operationId="listCurrentUserFlows"
          onRetry={() => void flowsQuery.refetch()}
        />
      )}

      {flowsQuery.isSuccess && (flows ?? []).length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <FilePlus2 className="text-muted-foreground mx-auto size-8" aria-hidden />
            <p className="mt-2 text-sm">{t("precheck.new.empty")}</p>
          </CardContent>
        </Card>
      )}

      {flowsQuery.isSuccess && (flows ?? []).length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(flows ?? []).map((flow) => (
            <Card key={flow.id} data-testid="flow-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="size-4" aria-hidden />
                  {flow.name}
                </CardTitle>
                <CardDescription>{t("precheck.new.flowCardDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <StagePath flow={flow} />
              </CardContent>
              <CardFooter>
                <Button
                  onClick={() => {
                    setSelected(flow);
                    setTitle("");
                    setDescription("");
                  }}
                  data-testid={`use-flow-${flow.id}`}
                >
                  {t("precheck.new.useFlow")}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent data-testid="create-draft-dialog">
          <DialogHeader>
            <DialogTitle>{t("precheck.new.dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("precheck.new.dialog.description", { flow: selected?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="draft-title">{t("precheck.new.dialog.titleLabel")}</Label>
              <Input
                id="draft-title"
                value={title}
                onChange={(event) => { setTitle(event.target.value); }}
                maxLength={256}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-description">
                {t("precheck.new.dialog.descriptionLabel")}
              </Label>
              <Textarea
                id="draft-description"
                value={description}
                onChange={(event) => { setDescription(event.target.value); }}
                rows={3}
                maxLength={4096}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelected(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => { createMutation.mutate(); }}
              disabled={title.trim() === "" || createMutation.isPending}
              data-testid="create-draft-confirm"
            >
              {t("precheck.new.dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
