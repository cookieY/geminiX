import i18next from "@/shared/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ShieldCheck, UserRound } from "lucide-react";
import type { User, UserDeletionImpact } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
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
  useCreateUser,
  useDeletionImpact,
  useDeleteUser,
  useUpdateUser,
  useUsers,
} from "@/features/admin/use-admin";

/**
 * 用户管理 (route /admin/users; migration contract §2 maps legacy
 * /manager/user here, P102/P105). v4 model: create (username/display_name/
 * email/password), edit display_name/email only, delete behind a full
 * impact preview. There is NO role management, NO department/recorder
 * column (P102) and NO disabled state (P105: users have deletion but no
 * disable); the builtin admin row is immutable (1103). The legacy
 * per-user permission-group binding moved to the permission-group form.
 */

function describeErrorText(display: { messageKey: string; requestId: string | null }): string {
  // Translated through the shared i18n bundle so users never see raw keys.
  const text = i18next.t(display.messageKey);
  return display.requestId === null ? text : `${text} (${display.requestId})`;
}

interface UserFormState {
  username: string;
  displayName: string;
  email: string;
  password: string;
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdmin = session.user?.can_access_admin === true;
  const usersQuery = useUsers(isAdmin);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const users = usersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="admin-users-page">
      <PageBreadcrumb title={t("nav.admin.users")} />
      <header className="flex flex-row items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminUsers.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("adminUsers.description")}</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); }} data-testid="admin-users-create">
          <Plus />
          {t("adminUsers.create")}
        </Button>
      </header>

      {usersQuery.isPending && <LoadingState />}
      {usersQuery.error !== null && (
        <ErrorState error={usersQuery.error} operationId="listUsers" onRetry={() => void usersQuery.refetch()} />
      )}

      {!usersQuery.isPending && usersQuery.error === null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("adminUsers.card")}</CardTitle>
            <CardDescription>{t("adminUsers.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm" data-testid="admin-users-empty">
                {t("adminUsers.empty")}
              </p>
            ) : (
              <Table data-testid="admin-users-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminUsers.column.username")}</TableHead>
                    <TableHead>{t("adminUsers.column.displayName")}</TableHead>
                    <TableHead>{t("adminUsers.column.email")}</TableHead>
                    <TableHead>{t("adminUsers.column.kind")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <UserRow key={user.id} user={user} onEdit={() => { setEditing(user); }} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <CreateUserDialog open={createOpen} onClose={() => { setCreateOpen(false); }} />
      <EditUserDialog user={editing} onClose={() => { setEditing(null); }} />
    </div>
  );
}

function UserRow({ user, onEdit }: { user: User; onEdit: () => void }) {
  const { t } = useTranslation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const impactQuery = useDeletionImpact(user.id, deleteOpen);
  const deleteUser = useDeleteUser();
  const [errorText, setErrorText] = useState<string | null>(null);

  return (
    <>
      <TableRow data-testid={`admin-user-row-${user.id}`}>
        <TableCell className="font-mono text-xs">{user.username}</TableCell>
        <TableCell>{user.display_name}</TableCell>
        <TableCell className="text-muted-foreground text-xs">{user.email ?? "—"}</TableCell>
        <TableCell>
          {user.is_builtin_admin ? (
            <Badge variant="secondary" className="gap-0.5">
              <ShieldCheck className="size-3" />
              {t("adminUsers.builtinAdmin")}
            </Badge>
          ) : (
            <Badge variant="outline">{t("adminUsers.localUser")}</Badge>
          )}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onEdit} data-testid={`admin-user-edit-${user.id}`}>
              {t("common.edit")}
            </Button>
            {!user.is_builtin_admin && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setErrorText(null);
                  setDeleteOpen(true);
                }}
                data-testid={`admin-user-delete-${user.id}`}
              >
                {t("common.delete")}
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      <DeleteUserDialog
        user={user}
        open={deleteOpen}
        impact={impactQuery.data ?? null}
        loading={impactQuery.isPending}
        submitting={deleteUser.isPending}
        errorText={errorText}
        onCancel={() => { setDeleteOpen(false); }}
        onConfirm={async () => {
          setErrorText(null);
          try {
            await deleteUser.mutateAsync({ userId: user.id, version: user.version });
            setDeleteOpen(false);
          } catch (error) {
            setErrorText(describeErrorText(describeError(error, "deleteUser")));
          }
        }}
      />
    </>
  );
}

function DeleteUserDialog({
  user,
  open,
  impact,
  loading,
  submitting,
  errorText,
  onCancel,
  onConfirm,
}: {
  user: User;
  open: boolean;
  impact: UserDeletionImpact | null;
  loading: boolean;
  submitting: boolean;
  errorText: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent data-testid="admin-user-delete-dialog">
        <DialogHeader>
          <DialogTitle>{t("adminUsers.delete.title", { name: user.username })}</DialogTitle>
          <DialogDescription>{t("adminUsers.delete.description")}</DialogDescription>
        </DialogHeader>
        {loading && <p className="text-muted-foreground text-sm">{t("common.loading")}</p>}
        {impact !== null && (
          <div className="flex flex-col gap-2 text-sm" data-testid="admin-user-delete-impact">
            <ImpactRow label={t("adminUsers.delete.flowReferences")} value={impact.flow_actor_references} />
            <ImpactRow label={t("adminUsers.delete.groupMemberships")} value={impact.permission_group_memberships} />
            <ImpactRow label={t("adminUsers.delete.activeGrants")} value={impact.active_query_grants} />
            <ImpactRow label={t("adminUsers.delete.activeSessions")} value={impact.active_query_sessions} />
            <p className="text-muted-foreground text-xs">{t("adminUsers.delete.snapshotsPreserved")}</p>
            {impact.blockers.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>{t("adminUsers.delete.blocked")}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {impact.blockers.map((blocker) => (
                      <li key={blocker.code}>
                        {blocker.code} × {blocker.count}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
        {errorText !== null && (
          <Alert variant="destructive" data-testid="admin-user-delete-error">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={loading || submitting || (impact !== null && !impact.can_delete)}
            onClick={() => void onConfirm()}
            data-testid="admin-user-delete-confirm"
          >
            {submitting ? t("common.saving") : t("adminUsers.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-row items-center justify-between gap-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="tabular-nums text-sm">{value}</span>
    </div>
  );
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const createUser = useCreateUser();
  const [form, setForm] = useState<UserFormState>({
    username: "",
    displayName: "",
    email: "",
    password: "",
  });
  const [errorText, setErrorText] = useState<string | null>(null);

  const valid =
    form.username.trim() !== "" &&
    form.displayName.trim() !== "" &&
    form.password.length >= 12 &&
    (form.email.trim() === "" || /.+@.+\..+/.test(form.email));

  const submit = async () => {
    setErrorText(null);
    try {
      await createUser.mutateAsync({
        username: form.username,
        display_name: form.displayName,
        email: form.email.trim() === "" ? null : form.email,
        password: form.password,
      });
      setForm({ username: "", displayName: "", email: "", password: "" });
      onClose();
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "createUser")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="admin-user-create-dialog">
        <DialogHeader>
          <DialogTitle>{t("adminUsers.createTitle")}</DialogTitle>
          <DialogDescription>{t("adminUsers.createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-create-username">{t("adminUsers.column.username")}</Label>
            <Input
              id="user-create-username"
              value={form.username}
              onChange={(event) => { setForm({ ...form, username: event.target.value }); }}
              maxLength={64}
              data-testid="user-create-username"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-create-display">{t("adminUsers.column.displayName")}</Label>
            <Input
              id="user-create-display"
              value={form.displayName}
              onChange={(event) => { setForm({ ...form, displayName: event.target.value }); }}
              maxLength={128}
              data-testid="user-create-display"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-create-email">{t("adminUsers.column.email")}</Label>
            <Input
              id="user-create-email"
              type="email"
              value={form.email}
              onChange={(event) => { setForm({ ...form, email: event.target.value }); }}
              data-testid="user-create-email"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-create-password">{t("adminUsers.password")}</Label>
            <Input
              id="user-create-password"
              type="password"
              value={form.password}
              onChange={(event) => { setForm({ ...form, password: event.target.value }); }}
              data-testid="user-create-password"
            />
            <p className="text-muted-foreground text-xs">{t("adminUsers.passwordHint")}</p>
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="admin-user-create-error">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || createUser.isPending} onClick={() => void submit()} data-testid="user-create-submit">
            {createUser.isPending ? t("common.saving") : t("adminUsers.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useTranslation();
  const updateUser = useUpdateUser();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);

  if (user !== null && openFor !== user.id) {
    setOpenFor(user.id);
    setDisplayName(user.display_name ?? "");
    setEmail(user.email ?? "");
    setErrorText(null);
  }
  if (user === null && openFor !== null) {
    setOpenFor(null);
  }

  const submit = async () => {
    if (user === null) return;
    setErrorText(null);
    try {
      await updateUser.mutateAsync({
        userId: user.id,
        version: user.version,
        body: { display_name: displayName, email: email.trim() === "" ? null : email },
      });
      onClose();
    } catch (error) {
      setErrorText(describeErrorText(describeError(error, "updateUser")));
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="admin-user-edit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="size-4" />
            {t("adminUsers.editTitle", { name: user?.username ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("adminUsers.editDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-edit-display">{t("adminUsers.column.displayName")}</Label>
            <Input
              id="user-edit-display"
              value={displayName}
              onChange={(event) => { setDisplayName(event.target.value); }}
              maxLength={128}
              data-testid="user-edit-display"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-edit-email">{t("adminUsers.column.email")}</Label>
            <Input
              id="user-edit-email"
              type="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); }}
              data-testid="user-edit-email"
            />
          </div>
          {errorText !== null && (
            <Alert variant="destructive" data-testid="admin-user-edit-error">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={displayName.trim() === "" || updateUser.isPending}
            onClick={() => void submit()}
            data-testid="user-edit-submit"
          >
            {updateUser.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
