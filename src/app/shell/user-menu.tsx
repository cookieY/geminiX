import { lazy, Suspense, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import type { SessionUser } from "@/shared/session/session";

const UserMenuSheet = lazy(() =>
  import("./user-menu-sheet").then((module) => ({ default: module.UserMenuSheet })),
);

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
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        className="hover:bg-primary/5 h-10 w-10 cursor-pointer rounded-full"
        aria-label={t("shell.userMenu.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="user-menu-trigger"
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
      >
        <span className="bg-muted flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium">
          Y
        </span>
      </Button>
      {requested && (
        <Suspense fallback={null}>
          <UserMenuSheet
            user={userOverride}
            open={open}
            onOpenChange={setOpen}
            returnFocusRef={triggerRef}
            panelId={panelId}
          />
        </Suspense>
      )}
    </>
  );
}
