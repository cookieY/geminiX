import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card } from "@/shared/components/ui/card";

interface PageBreadcrumbProps {
  title: string;
}

/**
 * Page title bar following the frozen template's breadcrumb card: title on
 * the left, Home / current-page trail on the right. Pages render it inside
 * the shell content container.
 */
export function PageBreadcrumb({ title }: PageBreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden rounded-xl border bg-background px-6 py-5">
      <div className="relative flex items-center justify-between gap-6">
        <h4 className="text-xl font-semibold">{title}</h4>
        <ol className="flex items-center whitespace-nowrap" aria-label={t("shell.breadcrumb")}>
          <li className="flex items-center">
            <Link to="/workspace" className="text-sm leading-none">
              {t("nav.home")}
            </Link>
          </li>
          <li className="mx-2" aria-hidden="true">
            <div className="p-0.5">/</div>
          </li>
          <li className="flex items-center text-sm leading-none opacity-80" aria-current="page">
            {title}
          </li>
        </ol>
      </div>
    </Card>
  );
}
