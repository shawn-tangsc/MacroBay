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
