import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { buttonVariants } from "@/shared/components/ui/button";
import { summarizeReleaseNotes, type LatestRelease } from "@/routes/workspace/release-notes";

/**
 * Home release banner (template "Update" slot; owner ruling 2026-09-02):
 * the latest release of the upstream repository, fetched client-side from
 * the public GitHub REST API (owner decision — no backend surface exists
 * for release metadata). The endpoint is inlined at build time as
 * __RELEASE_LATEST_URL__ (vite.config.ts); when it is unset or the fetch
 * fails the banner hides (dashboard PRD §4: statistics failures never block
 * the core workspace). Mock/e2e builds point it at a same-origin MSW
 * fixture so tests stay on localhost and byte-stable.
 */

const NOTES_EXCERPT_LIMIT = 50;

async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(__RELEASE_LATEST_URL__, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error("release fetch failed: " + String(response.status));
  }
  return (await response.json()) as LatestRelease;
}

export function useLatestReleaseQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["github", "release", __RELEASE_LATEST_URL__],
    queryFn: fetchLatestRelease,
    enabled: enabled && __RELEASE_LATEST_URL__ !== "",
    // The public API rate-limits per IP (60/h) — a home banner must not
    // chase it with the dashboard's 60s refetch cadence.
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function ReleaseBanner({ release }: { release: LatestRelease | undefined }) {
  const { t } = useTranslation();
  if (release === undefined) return null;
  return (
    <Card data-testid="workspace-release-banner" className="py-3">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-chart-1 size-2 rounded-full" aria-hidden />
            <p className="text-sm font-medium">{t("dashboard.release.latestLabel")}</p>
            <span className="bg-border size-1 rounded-full" aria-hidden />
            <p className="text-sm font-normal font-mono" data-testid="release-tag">
              {release.tag_name}
            </p>
          </div>
          <p className="text-muted-foreground text-sm" data-testid="release-notes-excerpt">
            {summarizeReleaseNotes(release.body ?? "", NOTES_EXCERPT_LIMIT)}
          </p>
        </div>
        <a
          href={release.html_url}
          target="_blank"
          rel="noreferrer noopener"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("dashboard.release.details")}
          <ArrowRight className="size-4" />
        </a>
      </CardContent>
    </Card>
  );
}
