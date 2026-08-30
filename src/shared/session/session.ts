import type { SessionRole } from "@/app/shell/nav-model";
import type { CurrentUser } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Presentation-layer view of the authenticated identity, derived from the
 * generated `CurrentUser` contract (GET /users/me). FE-F3 replaces the FE-F2
 * placeholder: the server session cookie is the only auth boundary and
 * `can_access_admin` is the server capability that drives admin navigation
 * and route guards — never a client-side authorization decision.
 */
export interface SessionUser {
  displayName: string;
  canAccessAdmin: boolean;
}

/**
 * The nav IA filter stays a presentation concern: admin-filtered groups are
 * hidden unless the server says the user can access admin surfaces.
 */
export function sessionRole(user: SessionUser): SessionRole {
  return user.canAccessAdmin ? "admin" : "user";
}

export function toSessionUser(currentUser: CurrentUser): SessionUser {
  return {
    displayName: currentUser.display_name ?? currentUser.username,
    canAccessAdmin: currentUser.can_access_admin,
  };
}

export function sessionRoleFromCurrentUser(currentUser: CurrentUser | null): SessionRole {
  if (currentUser === null) return "user";
  return sessionRole(toSessionUser(currentUser));
}
