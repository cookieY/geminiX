/** IANA zone choices for timezone pickers: the runtime's supported zones plus
 * UTC. The currently stored value is always kept selectable (even when the
 * runtime list lacks it) so a server-held zone is displayed rather than
 * blanked. The server stays the authority on whether a zone really exists. */
export function timezoneOptions(current: string): string[] {
  const zones = new Set<string>(["UTC"]);
  try {
    for (const zone of Intl.supportedValuesOf("timeZone")) zones.add(zone);
  } catch {
    ["Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York"].forEach((zone) => zones.add(zone));
  }
  if (current.trim() !== "") zones.add(current);
  return [...zones].sort((left, right) => left.localeCompare(right));
}
