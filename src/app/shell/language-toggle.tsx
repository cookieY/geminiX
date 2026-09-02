import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { toggleLocale } from "@/shared/i18n";

/** Locale toggle to the right of the theme toggle (owner ruling 2026-09-02):
 * flips between the two first-release locales and persists the choice. */
export function LanguageToggle() {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="btn-circle-hover"
      aria-label={t("shell.toggleLocale")}
      data-testid="locale-toggle"
      onClick={toggleLocale}
    >
      <Languages className="size-5" aria-hidden />
    </Button>
  );
}
