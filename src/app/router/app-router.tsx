import { useMemo } from "react";
import { RouterProvider } from "react-router";
import { useSession } from "@/features/auth/session-provider";
import { toSessionUser } from "@/shared/session/session";
import { appRouter } from "@/app/router/router";
import { buildMigrationRouter } from "@/app/router/migration-router";

/**
 * Mode-selecting router host (migration contract §8): the session decides
 * which tree exists. Normal mode renders the standard app router — the
 * migration workbench is NOT registered there ("正常运行模式不得注册或打包
 * 可导航的迁移工作台入口"). When the server declares migration review mode
 * (/users/me capabilities includes "migration_review"), the minimal
 * migration router takes over: login, /admin/migrations and an explicit
 * maintenance page for every business deep link. The router instance is
 * rebuilt once per mode flip; React Router remounts, which is acceptable
 * because a mode switch is a different server deployment, not an in-app
 * navigation.
 */
export function AppRouter() {
  const { user } = useSession();
  const migrationReview = user === null ? false : toSessionUser(user).migrationReview;
  const router = useMemo(
    () => (migrationReview ? buildMigrationRouter() : appRouter),
    [migrationReview],
  );
  return <RouterProvider router={router} />;
}
