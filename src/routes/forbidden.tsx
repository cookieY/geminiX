import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ShieldBan } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";

/** Forbidden state page (403): presented when the server denies access. */
export default function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldBan />
          </EmptyMedia>
          <EmptyTitle>{t("states.forbiddenTitle")}</EmptyTitle>
          <EmptyDescription>{t("states.forbiddenDesc")}</EmptyDescription>
        </EmptyHeader>
        <Button render={<Link to="/workspace" />}>{t("error.backHome")}</Button>
      </Empty>
    </div>
  );
}
