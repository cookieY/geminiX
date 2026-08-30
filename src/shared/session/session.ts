import type { SessionRole } from "@/app/shell/nav-model";

/**
 * FE-F2 session placeholder. Real authentication (login, refresh, 401
 * handling, server capabilities) is FE-F3 scope; the shell only needs an
 * identity to render the user-menu structure and a role to demonstrate the
 * presentation-layer navigation filter. This value is never an authorization
 * decision.
 */
export interface SessionUser {
  displayNameKey: string;
  role: SessionRole;
}

export const PLACEHOLDER_SESSION_USER: SessionUser = {
  displayNameKey: "shell.sessionPlaceholder",
  role: "user",
};
