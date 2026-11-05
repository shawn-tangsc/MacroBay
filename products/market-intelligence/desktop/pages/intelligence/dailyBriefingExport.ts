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
  edition: Readonly<{ date: string; locale: string; periodId?: string; periodTime?: string }>
}>): string {
  // A day can hold several periods in the same language, so date + language no longer identifies the
  // file: two downloads would overwrite each other and the reader would keep the second one believing
  // it was the first. The period's own hour names it — an opaque id would be unique but unreadable,
  // and the reader is naming a file, not addressing a record.
  const period = periodTag(document.edition)
  return `mi-daily-brief-${document.edition.date}${period}-${document.edition.locale}.png`
}

/**
 * `-0700` for a period that has its own time, `-<id>` when it only has an id, nothing for `default`.
 *
 * An edition written before schema 13 has neither field and belongs to `default`; its file keeps the
 * name it always had, because renaming downloads the reader already made would only confuse them.
 */
function periodTag(edition: Readonly<{ periodId?: string; periodTime?: string }>): string {
  if (edition.periodId === undefined && edition.periodTime === undefined) return ''
  if (edition.periodTime !== undefined) {
    const at = new Date(edition.periodTime)
    if (Number.isFinite(at.getTime())) {
      const hour = String(at.getUTCHours()).padStart(2, '0')
      const minute = String(at.getUTCMinutes()).padStart(2, '0')
      return `-${hour}${minute}`
    }
  }
  const id = (edition.periodId ?? '').replace(/[^a-zA-Z0-9-]/g, '')
  return id === '' || id === 'default' ? '' : `-${id}`
}
