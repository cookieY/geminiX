import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/shared/components/ui/button";

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t("error.notFound")}</h1>
      <p className="text-sm text-muted-foreground">{t("error.notFoundDesc")}</p>
      <Button render={<Link to="/" />}>{t("error.backHome")}</Button>
    </div>
  );
}
