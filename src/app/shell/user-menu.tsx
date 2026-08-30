import { useTranslation } from "react-i18next";
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
import { PLACEHOLDER_SESSION_USER, type SessionUser } from "@/shared/session/session";

/**
 * Header user menu, following the frozen template's profile-sheet structure
 * (identity block, menu list, footer) with Yearning content. FE-F2 has no
 * real session, so every action renders disabled with its reason visible —
 * a disabled control must explain itself (spec §11) and the real identity,
 * profile and sign-out flows are FE-F3 scope.
 */
export function UserMenu({ user = PLACEHOLDER_SESSION_USER }: { user?: SessionUser }) {
  const { t } = useTranslation();
  const displayName = t(user.displayNameKey);
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
              {t(user.role === "admin" ? "shell.role.admin" : "shell.role.user")}
            </Badge>
          </div>
        </div>
        <div className="mt-6 border-t border-border">
          <ul className="flex flex-col gap-2 p-6">
            <li>
              <Button
                variant="ghost"
                disabled
                className="w-full justify-start gap-3 px-3 text-muted-foreground"
              >
                <UserRound className="size-4" />
                <span>{t("shell.userMenu.profile")}</span>
                <span className="sr-only">{t("shell.userMenu.reasonProfile")}</span>
              </Button>
            </li>
            <li>
              <Button
                variant="ghost"
                disabled
                className="w-full justify-start gap-3 px-3 text-muted-foreground"
              >
                <LogOut className="size-4" />
                <span>{t("shell.userMenu.logout")}</span>
                <span className="sr-only">{t("shell.userMenu.reasonSession")}</span>
              </Button>
            </li>
          </ul>
        </div>
        <SheetFooter>
          <Separator />
          <p className="text-center text-xs text-muted-foreground">
            {t("shell.userMenu.reasonSession")}
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
