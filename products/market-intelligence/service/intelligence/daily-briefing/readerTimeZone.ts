/**
 * The reader time zone the brief schedule, its cutoff and the "today" it reads all use.
 * Comes from the platform hook (the shell's single time zone reader); fixed UTC when a host
 * has not injected one, never the machine's zone.
 */
export function resolveBriefingTimeZone(hooks: Readonly<{ getTimeZone?: () => string }> | undefined): string {
  return hooks?.getTimeZone?.() ?? 'UTC'
}

