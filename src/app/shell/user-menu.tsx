import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { Separator } from "@/shared/components/ui/separator";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { UserRound, LogOut } from "lucide-react";
import { sessionRole, toSessionUser, type SessionUser } from "@/shared/session/session";
import { useSession } from "@/features/auth/session-provider";

/**
 * Header user menu, following the frozen template's profile-sheet structure
 * (identity block, menu list, footer) with Yearning content. The identity and
 * the badge come from the real server session (GET /users/me). Sign-out is a
 * real POST /auth/logout — the HttpOnly session cookie is revoked server-side
 * and the session cache is dropped before navigating to /login. The
 * profile action navigates to the settings-style profile page (FE-F10,
 * UI spec §5.1: avatar entry, never a sidebar item).
 */
export function UserMenu({ user: userOverride }: { user?: SessionUser }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const user =
    userOverride ??
    (session.user === null ? null : toSessionUser(session.user));
  const displayName = user === null ? t("shell.sessionPlaceholder") : user.displayName;
  const roleKey =
    user !== null && sessionRole(user) === "admin"
      ? "shell.role.admin"
      : "shell.role.user";

  const handleLogout = async () => {
    try {
      await session.logout();
    } catch {
      // onSettled already parked the session at anonymous; still leave.
    }
    void navigate("/login", { replace: true });
  };

  return (
    <Sheet>
      <SheetTrigger
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full hover:bg-primary/5"
        aria-label={t("shell.userMenu.open")}
      >
        <Avatar className="h-8 w-8">
          <AvatarFallback>Y</AvatarFallback>
        </Avatar>
      </SheetTrigger>
      <SheetContent side="right" className="w-full border-s-0 sm:max-w-80">
        <SheetHeader>
          <SheetTitle className="sr-only">{t("shell.userMenu.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("shell.userMenu.title")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col items-center justify-center gap-4 px-6 pt-10">
          <Avatar className="h-16 w-16">
            <AvatarFallback>Y</AvatarFallback>
          </Avatar>
          <div className="text-center">
            <p className="text-lg font-semibold">{displayName}</p>
            <Badge variant="secondary" className="mt-1">
              {t(roleKey)}
            </Badge>
          </div>
        </div>
        <div className="mt-6 border-t border-border">
          <ul className="flex flex-col gap-2 p-6">
            <li>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-3"
                onClick={() => void navigate("/profile")}
                disabled={session.status !== "authenticated"}
                data-testid="user-menu-profile"
              >
                <UserRound className="size-4" />
                <span>{t("shell.userMenu.profile")}</span>
              </Button>
            </li>
            <li>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-3"
                onClick={() => void handleLogout()}
                disabled={session.status !== "authenticated"}
              >
                <LogOut className="size-4" />
                <span>{t("shell.userMenu.logout")}</span>
                {session.status !== "authenticated" && (
                  <span className="sr-only">{t("shell.userMenu.reasonSession")}</span>
                )}
              </Button>
            </li>
          </ul>
        </div>
        <SheetFooter>
          <Separator />
          <p className="text-center text-xs text-muted-foreground">
            {t("shell.userMenu.footerNote")}
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
