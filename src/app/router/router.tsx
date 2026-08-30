import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { BlankLayout } from "@/app/layouts/blank-layout";
import { FullLayout } from "@/app/layouts/full-layout";
import {
  RedirectIfAuthenticated,
  RequireAdminCapability,
  RequireSession,
} from "@/app/router/guards";
import { Loadable } from "@/app/router/loadable";

// Route-level code splitting is a machine gate (migration contract §8):
// every page is lazy and the admin bundle must not enter the first screen.
const LoginPage = lazy(() => import("@/routes/login/login-page"));
const WorkspacePage = lazy(() => import("@/routes/workspace/workspace-page"));
const AdminUsersPage = lazy(() => import("@/routes/admin/admin-users-page"));
const ChangesNewPage = lazy(() => import("@/routes/changes/changes-new-page"));
const DraftWorkspacePage = lazy(() => import("@/routes/changes/draft-workspace-page"));
const MinePage = lazy(() => import("@/routes/changes/mine-page"));
const OrderDetailPage = lazy(() => import("@/routes/changes/order-detail-page"));
const NotFoundPage = lazy(() => import("@/routes/not-found"));
const ForbiddenPage = lazy(() => import("@/routes/forbidden"));

export const appRouter = createBrowserRouter([
  {
    path: "/login",
    element: (
      <BlankLayout>
        <RedirectIfAuthenticated>{Loadable(LoginPage)}</RedirectIfAuthenticated>
      </BlankLayout>
    ),
  },
  {
    path: "/",
    element: (
      <RequireSession>
        <FullLayout />
      </RequireSession>
    ),
    children: [
      { index: true, element: <Navigate to="/workspace" replace /> },
      { path: "workspace", element: Loadable(WorkspacePage) },
      {
        path: "changes/new",
        element: Loadable(ChangesNewPage),
      },
      {
        path: "changes/drafts/:draftId",
        element: Loadable(DraftWorkspacePage),
      },
      {
        path: "changes/mine",
        element: Loadable(MinePage),
      },
      {
        path: "changes/orders/:orderId",
        element: Loadable(OrderDetailPage),
      },
      {
        // Admin surfaces exist only behind the server-declared
        // `can_access_admin` capability (GET /users/me) — the guard is a
        // presentation boundary, the backend stays the authorization decision.
        path: "admin/users",
        element: (
          <RequireAdminCapability>{Loadable(AdminUsersPage)}</RequireAdminCapability>
        ),
      },
    ],
  },
  { path: "/403", element: Loadable(ForbiddenPage) },
  { path: "*", element: <Navigate to="/404" replace /> },
  { path: "/404", element: Loadable(NotFoundPage) },
]);
