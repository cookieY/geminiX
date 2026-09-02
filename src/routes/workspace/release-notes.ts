/**
 * GitHub release payload shaping for the home release banner (owner ruling
 * 2026-09-02: the banner slot shows the latest release from the upstream
 * repository, fetched client-side from the public REST API).
 */

export interface LatestRelease {
  tag_name: string;
  name?: string;
  published_at?: string;
  html_url: string;
  body?: string;
}

/** Release notes are free markdown; the banner shows one plain-text line,
 * hard-truncated at 50 characters with an ellipsis (owner ruling). */
export function summarizeReleaseNotes(body: string, limit = 50): string {
  const plain = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}
