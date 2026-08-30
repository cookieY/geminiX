import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { BlankLayout } from "@/app/layouts/blank-layout";
import { FullLayout } from "@/app/layouts/full-layout";
import { Loadable } from "@/app/router/loadable";

// Route-level code splitting is a machine gate (migration contract §8):
// every page is lazy and the admin bundle must not enter the first screen.
const LoginPage = lazy(() => import("@/routes/login/login-page"));
const WorkspacePage = lazy(() => import("@/routes/workspace/workspace-page"));
const NotFoundPage = lazy(() => import("@/routes/not-found"));
const ForbiddenPage = lazy(() => import("@/routes/forbidden"));

export const appRouter = createBrowserRouter([
  {
    path: "/login",
    element: <BlankLayout>{Loadable(LoginPage)}</BlankLayout>,
  },
  {
    path: "/",
    element: <FullLayout />,
    children: [
      { index: true, element: <Navigate to="/workspace" replace /> },
      { path: "workspace", element: Loadable(WorkspacePage) },
    ],
  },
  { path: "/403", element: Loadable(ForbiddenPage) },
  { path: "*", element: <Navigate to="/404" replace /> },
  { path: "/404", element: Loadable(NotFoundPage) },
]);
