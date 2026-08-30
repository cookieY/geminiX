import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import logoOnLight from "@/assets/brand/logo-on-light.jpeg";
import logoOnDark from "@/assets/brand/logo-on-dark.png";
import { cn } from "@/shared/lib/utils";

/**
 * Yearning brand wordmark, following the frozen template's FullLogo pattern:
 * the light-surface variant renders in light mode and the dark-surface
 * variant in dark mode. Provenance and hashes live in
 * src/assets/brand/asset-manifest.json; the link carries the product name so
 * the logo image is never the sole carrier of the brand.
 */
export function BrandLogo({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/workspace"
      aria-label={t("app.name")}
      className={cn("block max-w-[120px] overflow-hidden", className)}
    >
      <img
        src={logoOnLight}
        alt=""
        width={120}
        height={38}
        className="block max-w-[120px] dark:hidden"
      />
      <img
        src={logoOnDark}
        alt=""
        width={120}
        height={38}
        className="hidden max-w-[120px] dark:block"
      />
    </Link>
  );
}
