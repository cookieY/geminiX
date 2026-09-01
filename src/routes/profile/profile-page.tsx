import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Languages, Palette, ShieldCheck, UserRound } from "lucide-react";
import { useSession } from "@/features/auth/session-provider";
import { setLocale as persistLocale, type Locale } from "@/shared/i18n";
import { PageBreadcrumb } from "@/app/shell/page-breadcrumb";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { ThemeToggle } from "@/app/shell/theme-toggle";

/**
 * 个人中心 (UI spec §5.1: 入口为右上角头像，不进侧边栏；模板Settings分栏).
 * Five sections exactly as constrained: 个人资料 (server facts, read-only —
 * UpdateUserRequest is an admin operation, no self-service surface),
 * 账号与安全 (identity facts; password change has no declared endpoint —
 * the builtin-admin reset command is shown for the builtin admin only),
 * 外观 (theme), 通知 (read-only — channels are server-side admin surface),
 * 显示 (locale). Avatar uses the initial-letter fallback only.
 */

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const locale = i18n.resolvedLanguage ?? "zh-CN";

  return (
    <div className="flex flex-col gap-4" data-testid="profile-page">
      <PageBreadcrumb title={t("profile.title")} />
      <header>
        <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("profile.description")}</p>
      </header>
      <Tabs defaultValue="identity" className="gap-4">
        <TabsList>
          <TabsTrigger value="identity" data-testid="profile-tab-identity">
            <UserRound className="size-3.5" />
            {t("profile.tabs.identity")}
          </TabsTrigger>
          <TabsTrigger value="security" data-testid="profile-tab-security">
            <ShieldCheck className="size-3.5" />
            {t("profile.tabs.security")}
          </TabsTrigger>
          <TabsTrigger value="appearance" data-testid="profile-tab-appearance">
            <Palette className="size-3.5" />
            {t("profile.tabs.appearance")}
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="profile-tab-notifications">
            <Bell className="size-3.5" />
            {t("profile.tabs.notifications")}
          </TabsTrigger>
          <TabsTrigger value="display" data-testid="profile-tab-display">
            <Languages className="size-3.5" />
            {t("profile.tabs.display")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("profile.identity.title")}</CardTitle>
              <CardDescription>{t("profile.identity.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ProfileRow label={t("profile.identity.username")} value={user?.username ?? "—"} />
              <ProfileRow label={t("profile.identity.displayName")} value={user?.display_name ?? "—"} />
              <ProfileRow label={t("profile.identity.email")} value={user?.email ?? "—"} />
              <ProfileRow
                label={t("profile.identity.admin")}
                value={
                  user?.is_builtin_admin === true ? (
                    <Badge variant="secondary">{t("profile.identity.builtinAdmin")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("profile.identity.regularUser")}</Badge>
                  )
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("profile.security.title")}</CardTitle>
              <CardDescription>{t("profile.security.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-xs">{t("profile.security.passwordNote")}</p>
              {user?.is_builtin_admin === true && (
                <pre className="rounded-md border p-2 font-mono text-xs">
                  ./Yearning --reset-admin-password
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("profile.appearance.title")}</CardTitle>
              <CardDescription>{t("profile.appearance.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <span className="text-sm">{t("profile.appearance.theme")}</span>
              <ThemeToggle />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("profile.notifications.title")}</CardTitle>
              <CardDescription>{t("profile.notifications.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{t("profile.notifications.readOnlyNote")}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="display">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("profile.display.title")}</CardTitle>
              <CardDescription>{t("profile.display.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="profile-locale">{t("profile.display.locale")}</Label>
              <LocaleSelect
                locale={locale}
                onChange={(next) => {
                  void i18n.changeLanguage(next);
                  persistLocale(next as Locale);
                }}
              />
              <p className="text-muted-foreground text-xs">{t("profile.display.timezoneNote")}</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-row items-center justify-between gap-4 border-b pb-2 last:border-b-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function LocaleSelect({ locale, onChange }: { locale: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(locale);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === null) return;
        setValue(next);
        onChange(next);
      }}
    >
      <SelectTrigger id="profile-locale" className="w-48" data-testid="profile-locale-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="zh-CN" data-testid="profile-locale-zh">
          {t("profile.display.zhCN")}
        </SelectItem>
        <SelectItem value="en-US" data-testid="profile-locale-en">
          {t("profile.display.enUS")}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
