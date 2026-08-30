import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { BrandLogo } from "@/app/shell/brand-logo";

/**
 * Structural placeholder for the Local/LDAP/OIDC login screen (FE-F3 wires the
 * generated session API). Field grouping follows the legacy reference: the
 * Yearning contract keeps only Local, LDAP and OIDC entries.
 */
export default function LoginPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <BrandLogo />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("login.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              // Session API wiring arrives in FE-F3; submit is inert by design.
            }}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="username">{t("login.username")}</Label>
              <Input id="username" name="username" autoComplete="username" placeholder={t("login.placeholder.username")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={t("login.placeholder.password")}
              />
            </div>
            <Button type="submit">{t("login.submit")}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
