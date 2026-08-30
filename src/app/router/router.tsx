import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { BlankLayout } from "@/app/layouts/blank-layout";
import { Loadable } from "@/app/router/loadable";

// Route-level code splitting is a machine gate (migration contract §8):
// every page is lazy and the admin bundle must not enter the first screen.
const LoginPage = lazy(() => import("@/routes/login/login-page"));
const SkeletonPage = lazy(() => import("@/routes/skeleton/skeleton-page"));
const NotFoundPage = lazy(() => import("@/routes/not-found"));

export const appRouter = createBrowserRouter([
  {
    path: "/login",
    element: <BlankLayout>{Loadable(LoginPage)}</BlankLayout>,
  },
  {
    path: "/",
    element: <BlankLayout>{Loadable(SkeletonPage)}</BlankLayout>,
  },
  { path: "*", element: <Navigate to="/404" replace /> },
  { path: "/404", element: Loadable(NotFoundPage) },
]);
