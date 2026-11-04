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
  edition: Readonly<{ date: string; locale: string }>
}>): string {
  return `mi-daily-brief-${document.edition.date}-${document.edition.locale}.png`
}
