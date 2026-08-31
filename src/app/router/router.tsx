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
const AdminDatasourcesPage = lazy(() => import("@/routes/admin/admin-datasources-page"));
const AdminProvidersPage = lazy(() => import("@/routes/admin/admin-providers-page"));
const AdminAiBudgetPage = lazy(() => import("@/routes/admin/admin-ai-budget-page"));
const AdminRuleSetsPage = lazy(() => import("@/routes/admin/admin-rule-sets-page"));
const AdminReviewSkillsPage = lazy(() => import("@/routes/admin/admin-review-skills-page"));
const AdminReviewKnowledgePage = lazy(() => import("@/routes/admin/admin-review-knowledge-page"));
const ChangesNewPage = lazy(() => import("@/routes/changes/changes-new-page"));
const DraftWorkspacePage = lazy(() => import("@/routes/changes/draft-workspace-page"));
const MinePage = lazy(() => import("@/routes/changes/mine-page"));
const OrderDetailPage = lazy(() => import("@/routes/changes/order-detail-page"));
const ApprovalQueuePage = lazy(() => import("@/routes/approvals/approval-queue-page"));
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
        path: "approvals/changes",
        element: Loadable(ApprovalQueuePage),
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
      {
        path: "admin/datasources",
        element: (
          <RequireAdminCapability>{Loadable(AdminDatasourcesPage)}</RequireAdminCapability>
        ),
      },
      {
        path: "admin/review-engine/skills",
        element: (
          <RequireAdminCapability>{Loadable(AdminReviewSkillsPage)}</RequireAdminCapability>
        ),
      },
      {
        path: "admin/review-engine/knowledge",
        element: (
          <RequireAdminCapability>{Loadable(AdminReviewKnowledgePage)}</RequireAdminCapability>
        ),
      },
      {
        path: "admin/review-engine/providers",
        element: (
          <RequireAdminCapability>{Loadable(AdminProvidersPage)}</RequireAdminCapability>
        ),
      },
      {
        path: "admin/rule-sets",
        element: (
          <RequireAdminCapability>{Loadable(AdminRuleSetsPage)}</RequireAdminCapability>
        ),
      },
      {
        // The settings family splits per namespace (migration contract §2);
        // F9 delivers ai-budget, so the index redirects there until F10
        // ships the remaining namespace pages.
        path: "admin/settings",
        element: <Navigate to="/admin/settings/ai-budget" replace />,
      },
      {
        path: "admin/settings/ai-budget",
        element: (
          <RequireAdminCapability>{Loadable(AdminAiBudgetPage)}</RequireAdminCapability>
        ),
      },
    ],
  },
  { path: "/403", element: Loadable(ForbiddenPage) },
  { path: "*", element: <Navigate to="/404" replace /> },
  { path: "/404", element: Loadable(NotFoundPage) },
]);
