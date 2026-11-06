/**
 * The reader time zone the brief schedule, its cutoff and the "today" it reads all use.
 *
 * It comes from the platform hook (the shell's single time zone reader) and there is no fallback:
 * a missing hook used to resolve to UTC, which quietly put every reader in UTC while the interface
 * said otherwise. A missing hook is now a loud failure instead of a plausible-looking value.
 */
export function resolveBriefingTimeZone(hooks: Readonly<{ getTimeZone: () => string }> | undefined): string {
  if (!hooks?.getTimeZone) throw new Error('reader-time-zone-hook-missing')
  return hooks.getTimeZone()
}

