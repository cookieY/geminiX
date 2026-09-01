import i18next from "@/shared/i18n";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ShieldCheck } from "lucide-react";
import type { Flow, PermissionGroup, User } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import { useSession } from "@/features/auth/session-provider";
import { describeError } from "@/shared/api/error-display";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { ErrorState, LoadingState } from "@/shared/components/status/status-components";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import {
  useCreatePermissionGroup,
  useDeletePermissionGroup,
  useFlows,
  usePermissionGroups,
  useReplacePermissionGroup,
  useUsers,
} from "@/features/admin/use-admin";

/**
 * 权限组管理 (route /admin/permission-groups; migration contract §2 maps
 * legacy /manager/policy here, §3 field mapping: the three legacy
 * per-datasource transfer fields are DELETED — a group grants
 * members plus change/query FLOWS (P101: flows, never datasources or
 * workflow actors). The per-user effective permission preview derives from
 * the groups' server facts client-side (member ∪ granted flows). There is
 * deliberately no reviewer/executor authorization entry here.
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

interface GroupFormState {
  name: string;
  enabled: boolean;
  memberIds: string[];
  flowIds: string[];
}

export default function AdminPermissionGroupsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const groupsQuery = usePermissionGroups(isAdmin);
  const usersQuery = useUsers(isAdmin);
  const flowsQuery = useFlows(isAdmin);
  const [editing, setEditing] = useState<PermissionGroup | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [previewUser, setPreviewUser] = useState<string>("");

  const groups = groupsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const flows = flowsQuery.data ?? [];
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const flowById = useMemo(() => new Map(flows.map((flow) => [flow.id, flow])), [flows]);

  const preview = useMemo(() => {
    if (previewUser === "") return null;
    const membership = groups.filter((group) => group.member_user_ids.includes(previewUser) && group.enabled);
    const grantedFlowIds = new Set(membership.flatMap((group) => group.granted_flow_ids));
    return { groups: membership, flows: [...grantedFlowIds].map((id) => flowById.get(id)).filter((flow) => flow !== undefined) };
  }, [flowById, groups, previewUser]);

  const loadError = groupsQuery.error ?? usersQuery.error ?? flowsQuery.error;

  return (
    <div className="flex flex-col gap-4" data-testid="admin-groups-page">
      <PageBreadcrumb title={t("nav.admin.permissionGroups")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminGroups.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("adminGroups.description")}</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); }} data-testid="admin-groups-create">
          <Plus />
          {t("adminGroups.create")}
        </Button>
      </header>

      {loadError !== null && (
        <ErrorState
          error={loadError}
          operationId="listPermissionGroups"
          onRetry={() => {
            void groupsQuery.refetch();
            void usersQuery.refetch();
            void flowsQuery.refetch();
          }}
        />
      )}
      {loadError === null && groupsQuery.isPending && <LoadingState />}

      {loadError === null && !groupsQuery.isPending && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("adminGroups.preview.title")}</CardTitle>
              <CardDescription>{t("adminGroups.preview.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Input
                value={previewUser}
                onChange={(event) => { setPreviewUser(event.target.value); }}
                placeholder={t("adminGroups.preview.placeholder")}
                className="max-w-sm"
                list="admin-group-preview-users"
                data-testid="admin-groups-preview-input"
              />
              <datalist id="admin-group-preview-users">
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </datalist>
              {preview !== null && (
                <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid="admin-groups-preview-result">
                  <p className="text-xs">
                    <span className="text-muted-foreground">{t("adminGroups.preview.user")}: </span>
                    {userById.get(previewUser)?.username ?? previewUser}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {preview.groups.length === 0 && (
                      <span className="text-muted-foreground text-xs">{t("adminGroups.preview.noGroups")}</span>
                    )}
                    {preview.groups.map((group) => (
                      <Badge key={group.id} variant="outline">
                        {group.name}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {preview.flows.length === 0 && (
                      <span className="text-muted-foreground text-xs">{t("adminGroups.preview.noFlows")}</span>
                    )}
                    {preview.flows.map((flow) => (
                      <Badge key={flow.id} variant="secondary">
                        {flow.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4" />
                {t("adminGroups.card")}
              </CardTitle>
              <CardDescription>{t("adminGroups.cardDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {groups.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-groups-empty">
                  {t("adminGroups.empty")}
                </p>
              ) : (
                <Table data-testid="admin-groups-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("adminGroups.column.name")}</TableHead>
                      <TableHead>{t("adminGroups.column.enabled")}</TableHead>
                      <TableHead>{t("adminGroups.column.members")}</TableHead>
                      <TableHead>{t("adminGroups.column.flows")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => (
                      <GroupRow key={group.id} group={group} userById={userById} flowById={flowById} onEdit={() => { setEditing(group); }} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <GroupFormDialog
        open={createOpen}
        editing={null}
        users={users}
        flows={flows}
        onClose={() => { setCreateOpen(false); }}
      />
      <GroupFormDialog
        open={editing !== null}
        editing={editing}
        users={users}
        flows={flows}
        onClose={() => { setEditing(null); }}
      />
    </div>
  );
}

function GroupRow({
  group,
  userById,
  flowById,
  onEdit,
}: {
  group: PermissionGroup;
  userById: Map<string, User>;
  flowById: Map<string, Flow>;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const deleteGroup = useDeletePermissionGroup();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  return (
    <>
      <TableRow data-testid={`admin-group-row-${group.id}`}>
        <TableCell>{group.name}</TableCell>
        <TableCell>
          <Badge variant={group.enabled ? "secondary" : "outline"}>
            {group.enabled ? t("adminGroups.enabled") : t("adminGroups.disabled")}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground max-w-56 truncate text-xs">
          {group.member_user_ids
            .map((id) => userById.get(id)?.username ?? id)
            .join(", ") || "—"}
        </TableCell>
        <TableCell className="text-muted-foreground max-w-56 truncate text-xs">
          {group.granted_flow_ids
            .map((id) => flowById.get(id)?.name ?? id)
            .join(", ") || "—"}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onEdit} data-testid={`admin-group-edit-${group.id}`}>
              {t("common.edit")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setErrorText(null);
                setConfirmOpen(true);
              }}
              data-testid={`admin-group-delete-${group.id}`}
            >
              {t("common.delete")}
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!next) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminGroups.delete.title", { name: group.name })}</DialogTitle>
            <DialogDescription>{t("adminGroups.delete.description")}</DialogDescription>
          </DialogHeader>
          {errorText !== null && (
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteGroup.isPending}
              onClick={() => {
                deleteGroup.mutate(
                  { groupId: group.id, version: group.version },
                  {
                    onSuccess: () => { setConfirmOpen(false); },
                    onError: (error) => { setErrorText(describeErrorText(describeError(error, "deletePermissionGroup"))); },
                  },
                );
              }}
              data-testid="admin-group-delete-confirm"
            >
              {deleteGroup.isPending ? t("common.saving") : t("adminGroups.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GroupFormDialog({
  open,
  editing,
  users,
  flows,
  onClose,
}: {
  open: boolean;
  editing: PermissionGroup | null;
  users: User[];
  flows: Flow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createGroup = useCreatePermissionGroup();
  const replaceGroup = useReplacePermissionGroup();
  const [form, setForm] = useState<GroupFormState>({ name: "", enabled: true, memberIds: [], flowIds: [] });
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const formKey = editing?.id ?? "create";
  if (open && openFor !== formKey) {
    setOpenFor(formKey);
    setForm(
      editing === null
        ? { name: "", enabled: true, memberIds: [], flowIds: [] }
        : { name: editing.name, enabled: editing.enabled, memberIds: [...editing.member_user_ids], flowIds: [...editing.granted_flow_ids] },
    );
    setErrorText(null);
  }
  if (!open && openFor !== null) setOpenFor(null);

  const toggle = (list: "memberIds" | "flowIds", id: string) => {
    setForm((current) => ({
      ...current,
      [list]: current[list].includes(id) ? current[list].filter((item) => item !== id) : [...current[list], id],
    }));
  };

  const submit = async () => {
    setErrorText(null);
    const body = {
      name: form.name,
      enabled: form.enabled,
      member_user_ids: form.memberIds,
      granted_flow_ids: form.flowIds,
    };
    try {
      if (editing === null) {
        await createGroup.mutateAsync(body);
      } else {
        await replaceGroup.mutateAsync({ groupId: editing.id, version: editing.version, body });
      }
      onClose();
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, editing === null ? "createPermissionGroup" : "replacePermissionGroup")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing === null ? t("adminGroups.createTitle") : t("adminGroups.editTitle", { name: editing.name })}</DialogTitle>
          <DialogDescription>{t("adminGroups.formDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-name">{t("adminGroups.column.name")}</Label>
            <Input
              id="group-name"
              value={form.name}
              onChange={(event) => { setForm({ ...form, name: event.target.value }); }}
              maxLength={128}
              data-testid="group-name"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); }}
              data-testid="group-enabled"
            />
            {t("adminGroups.column.enabled")}
          </label>

          <div className="flex flex-col gap-2">
            <Label>{t("adminGroups.members")}</Label>
            <div className="max-h-48 overflow-y-auto rounded-md border p-2">
              {users.map((user) => (
                <label key={user.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.memberIds.includes(user.id)}
                    onChange={() => { toggle("memberIds", user.id); }}
                    data-testid={`group-member-${user.id}`}
                  />
                  {user.display_name}
                  <span className="text-muted-foreground font-mono text-xs">{user.username}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("adminGroups.flows")}</Label>
            <p className="text-muted-foreground text-xs">{t("adminGroups.flowsHint")}</p>
            <div className="max-h-48 overflow-y-auto rounded-md border p-2">
              {flows.length === 0 && (
                <p className="text-muted-foreground p-2 text-xs">{t("adminGroups.noFlows")}</p>
              )}
              {flows.map((flow) => (
                <label key={flow.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.flowIds.includes(flow.id)}
                    onChange={() => { toggle("flowIds", flow.id); }}
                    data-testid={`group-flow-${flow.id}`}
                  />
                  {flow.name}
                  <Badge variant="outline">
                    {flow.flow_type === "change_review" ? t("adminGroups.flowKind.change") : t("adminGroups.flowKind.query")}
                  </Badge>
                </label>
              ))}
            </div>
          </div>

          {errorText !== null && (
            <Alert variant="destructive" data-testid="group-form-error">
              <AlertTitle>{t("adminGroups.formFailed")}</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={form.name.trim() === "" || createGroup.isPending || replaceGroup.isPending}
            onClick={() => void submit()}
            data-testid="group-form-submit"
          >
            {createGroup.isPending || replaceGroup.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
