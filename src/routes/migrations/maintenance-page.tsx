import { useTranslation } from "react-i18next";
import { Construction } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

/**
 * Maintenance page for the migration-mode router (migration contract §8:
 * 迁移模式只注册登录、退出和/admin/migrations，任何普通业务深链都进入
 * 明确的维护页). This is NOT a 404: the route exists but the whole normal
 * business surface is unavailable while the server runs in migration review
 * mode (503 on every business API).
 */
export default function MigrationMaintenancePage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center p-6" data-testid="migration-maintenance">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="size-5" />
            {t("migrationMode.maintenanceTitle")}
          </CardTitle>
          <CardDescription>{t("migrationMode.maintenanceDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => { window.location.href = "/admin/migrations"; }} data-testid="migration-maintenance-goto">
            {t("migrationMode.gotoWorkbench")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
