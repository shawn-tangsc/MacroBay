/** The printed sheet's width. One number: the page scales it, the export copies it, nothing re-derives it. */
export const BRIEFING_PAPER_WIDTH = 1080

/**
 * The paper colour the share poster is drawn on, read back from the rendered card.
 *
 * The poster is a fixed print palette declared in its own stylesheet, and the PNG export needs a
 * flat background behind it. Writing that colour a second time in the export call meant a later
 * palette change would leave every downloaded image on the old paper — the reader shares the image,
 * the interface moves on. The stylesheet stays the owner.
 *
 * Returns undefined when the element paints no background (a transparent or unreadable value), so
 * the export keeps the library's default instead of painting an opaque black-ish fallback.
 */
export function posterExportBackground(poster: Element | null): string | undefined {
  if (!poster || typeof getComputedStyle !== 'function') return undefined
  const painted = getComputedStyle(poster).backgroundColor
  if (!painted || painted === 'transparent' || painted === 'rgba(0, 0, 0, 0)') return undefined
  return painted
}

/**
 * The downloaded image's file name: the edition it contains decides the language tag.
 *
 * It used to take the interface language, so exporting an English edition from a Chinese interface
 * produced a `-zh-CN.png` file — the reader then has no way to tell which language the picture is in.
 */
export function briefingExportFileName(document: Readonly<{
  edition: Readonly<{
    date: string
    locale: string
    periodId?: string
    periodTime?: string
    periodKind?: 'scheduled' | 'manual'
    windowHours?: number
    generatedAt?: string
  }>
}>): string {
  // A day can hold several periods in the same language, so date + language no longer identifies the
  // file: two downloads would overwrite each other and the reader would keep the second one believing
  // it was the first. What goes in the name is whatever that edition needs to be told apart — the
  // rule is "any two editions of one day get different names", not "the name must carry field X".
  const period = periodTag(document.edition)
  return `mi-daily-brief-${document.edition.date}${period}-${document.edition.locale}.png`
}

/**
 * The suffix that tells this edition apart from the others of its day.
 *
 * Nothing at all for an edition written before schema 13: it belongs to `default`, and its file keeps
 * the name it always had — renaming downloads the reader already made would only confuse them.
 *
 * Otherwise: the period's hour, its window, and — only for a manual run — the minute and second it
 * finished at. Two manual runs can share hour, window and language (a deliberate re-run), and the
 * finished instant is the only thing left that differs. Scheduled periods never need it: one per hour
 * and window is what the uniqueness rule already allows.
 */
function periodTag(edition: Readonly<{
  periodId?: string
  periodTime?: string
  periodKind?: 'scheduled' | 'manual'
  windowHours?: number
  generatedAt?: string
}>): string {
  const parts: string[] = []
  const clock = (iso: string | undefined, seconds: boolean): string | undefined => {
    if (iso === undefined) return undefined
    const at = new Date(iso)
    if (!Number.isFinite(at.getTime())) return undefined
    const hhmm = `${String(at.getUTCHours()).padStart(2, '0')}${String(at.getUTCMinutes()).padStart(2, '0')}`
    return seconds ? `${hhmm}${String(at.getUTCSeconds()).padStart(2, '0')}` : hhmm
  }
  const hour = clock(edition.periodTime, false)
  if (hour !== undefined) parts.push(hour)
  if (edition.windowHours !== undefined) parts.push(`${edition.windowHours}h`)
  if (edition.periodKind === 'manual') {
    const finished = clock(edition.generatedAt, true)
    if (finished !== undefined) parts.push(finished)
  }
  if (parts.length === 0) {
    const id = (edition.periodId ?? '').replace(/[^a-zA-Z0-9-]/g, '')
    if (id === '' || id === 'default') return ''
    return `-${id}`
  }
  return `-${parts.join('-')}`
}
