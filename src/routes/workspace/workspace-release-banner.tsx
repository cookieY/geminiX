import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { buttonVariants } from "@/shared/components/ui/button";
import { summarizeReleaseNotes } from "@/routes/workspace/release-notes";
import type { ReleaseSnapshot } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Home release banner (template "Update" slot; owner ruling 2026-09-02,
 * revised 2026-10-20 by RCP-20261020-RELEASE-FEED-BACKEND): the latest
 * release snapshot this instance's backend fetched from the upstream
 * repository (startup + daily refresh). The browser never talks to
 * api.github.com — the unauthenticated quota is per shared IP and its
 * exhaustion used to collapse the whole slot. When the backend has no
 * snapshot yet the banner still renders at minimum height with a
 * placeholder (owner ruling: the slot never disappears for lack of data).
 * Owner ruling 2026-10-20 (same day): a green "update now" tag renders
 * beside the latest tag when the installed reference (current_version,
 * seeded at serve startup) differs from upstream latest, linking to the
 * release page in a new tab; first install (current_version null) renders
 * no tag. The sidebar badge shows the installed reference.
 */

const NOTES_EXCERPT_LIMIT = 50;

export function useLatestReleaseQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["releases", "latest"],
    queryFn: async () => {
      const { getLatestRelease } = await import(
        "@/api/generated/client/dashboard/dashboard"
      );
      return (await getLatestRelease()) as unknown as ReleaseSnapshot | null;
    },
    enabled,
    // Backend snapshot refreshes daily server-side; client-side staleness
    // only bounds re-fetches by the workspace 60s refresh cadence.
    staleTime: 60_000,
    retry: false,
  });
}

export function ReleaseBanner({ release }: { release: ReleaseSnapshot | null | undefined }) {
  const { t } = useTranslation();
  const hasRelease = release != null;
  // Owner ruling 2026-10-20: green "update now" tag when the installed
  // reference (current_version, seeded at serve startup) differs from the
  // upstream latest; absent on first install (current_version null).
  const hasUpdate =
    hasRelease && release.current_version != null && release.current_version !== release.tag_name;
  return (
    <Card data-testid="workspace-release-banner" className="min-h-[72px] py-3">
      <CardContent className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-chart-1 size-2 rounded-full" aria-hidden />
            <p className="text-sm font-medium">{t("dashboard.release.latestLabel")}</p>
            <span className="bg-border size-1 rounded-full" aria-hidden />
            <p className="text-sm font-normal font-mono" data-testid="release-tag">
              {hasRelease ? release.tag_name : "—"}
            </p>
            {hasUpdate && (
              <a
                href={release.html_url}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="release-update-now"
                className="bg-success/15 text-success rounded-md px-2 py-0.5 text-xs font-medium"
              >
                {t("dashboard.release.updateNow")}
              </a>
            )}
          </div>
          <p className="text-muted-foreground text-sm" data-testid="release-notes-excerpt">
            {hasRelease
              ? summarizeReleaseNotes(release.body, NOTES_EXCERPT_LIMIT)
              : t("dashboard.release.unavailable")}
          </p>
        </div>
        {hasRelease && (
          <a
            href={release.html_url}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonVariants({ variant: "outline" })}
          >
            {t("dashboard.release.details")}
            <ArrowRight className="size-4" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}
