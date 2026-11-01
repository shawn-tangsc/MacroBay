/**
 * Short names for official release titles on the share card.
 *
 * The card has one line per upcoming event, so a title like 「制造业采购经理人指数」 spends the
 * width the reader needs for the date and the reading. The table rewrites the official Chinese
 * wording into the abbreviation the same reader uses when talking about it.
 *
 * It is a Chinese-source transform and sits behind the locale branch on purpose: an English edition
 * already carries translated titles, so the Chinese patterns could only ever be a no-op there — and
 * a no-op that silently edits text if an English title ever echoes the Chinese wording. Keeping it
 * in the renderer next to a raw `replace` is what made that impossible to see.
 */
const chineseTitleAbbreviations: readonly Readonly<{ pattern: RegExp; short: string }>[] = Object.freeze([
  { pattern: /制造业采购经理人指数/g, short: '制造业 PMI' },
  { pattern: /采购经理人指数/g, short: 'PMI' },
  { pattern: /消费者物价指数/g, short: 'CPI' },
  { pattern: /生产者物价指数/g, short: 'PPI' },
  { pattern: /非农就业人口变动/g, short: '非农就业' }
])

/** The title as the card shows it; other languages keep the title they were given. */
export function shortenEventTitle(value: string, locale: 'zh-CN' | 'en-US'): string {
  if (locale !== 'zh-CN') return value
  return chineseTitleAbbreviations.reduce((current, { pattern, short }) => current.replace(pattern, short), value)
}
