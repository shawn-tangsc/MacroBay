import type { StructuredModelMessage } from '@platform/ai/invocation/structuredModelInvocationTypes'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

export const dailyBriefingPromptVersion = 'daily-briefing.editorial.v1'

/**
 * The editorial prompt is bounded to the frozen document: the model may add prose and a visibility
 * ranking, never a new fact. Every fact it can name has an id in `facts`, and every number it may
 * repeat is already in that JSON.
 */
export function buildDailyBriefingPrompt(input: Readonly<{
  document: DailyBriefingDocument
  locale: 'zh-CN' | 'en-US'
}>): StructuredModelMessage[] {
  const { document, locale } = input
  const facts = {
    locale,
    edition: { date: document.edition.date, windowStart: document.edition.windowStart, windowEnd: document.edition.windowEnd },
    conclusion: document.conclusion ? {
      direction: document.conclusion.direction,
      summary: document.conclusion.summary,
      conditions: document.conclusion.conditions,
      invalidations: document.conclusion.invalidations.map((item) => item.text),
      counterEvidence: document.conclusion.counterEvidence.map((item) => item.statement)
    } : null,
    news: document.news.items.map((item) => ({
      factId: `news:${item.itemId}`,
      title: item.translatedTitle ?? item.title,
      source: item.sourceName,
      polarity: item.polarity,
      strength: item.strength,
      confidence: item.confidence
    })),
    macro: document.news.macro.map((item) => ({
      factId: `macro:${item.eventKey}`,
      title: item.title,
      actual: item.actual ?? null,
      consensus: item.consensus ?? null,
      previous: item.previous ?? null,
      surprise: item.surprise.direction
    })),
    data: dataFacts(document),
    mustFloor: dataFacts(document).filter((item) => item.must).map((item) => item.factId)
  }
  return [
    {
      role: 'system',
      content: [
        'You are the editor of a frozen daily market brief. Write in the requested locale.',
        'Return one JSON object and nothing else. Do not use markdown fences, URLs, code, or a preamble.',
        'Do not add facts, numbers, prices, targets, or buy/sell advice. Only use numbers that already appear in FACTS.',
        'The reader is a professional: short, concrete, no filler, no "the market is complex".',
        'Every string must be plain prose; no HTML and no bullet lists inside a string.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `LOCALE: ${locale}`,
        'FACTS:',
        JSON.stringify(facts, null, 2),
        '',
        'Write this exact JSON shape:',
        JSON.stringify({
          lede: '2-3 sentences: the day’s main line and its tension. No numbers outside FACTS.',
          items: [
            { factId: 'news:<id>', why: 'one sentence, at most 200 characters' },
            { factId: 'macro:<key>', why: 'one sentence, at most 200 characters' }
          ],
          importance: [
            { factId: 'data:<id>', tier: 'must|support|reference', reasonText: 'one short sentence, at most 200 characters' }
          ],
          dataNote: 'one sentence about what the numbers say, at most 240 characters',
          invalidationNote: 'one sentence about what would change the read, at most 240 characters',
          conclusionTranslation: 'translate the conclusion summary only, or omit'
        }, null, 2),
        '',
        'RULES:',
        '- items: at most 3, only news:/macro: factIds, no duplicates, order by importance. Do not fill a quota.',
        '- importance: only data: factIds, unique, must/support/reference. The mustFloor rows may be lifted or kept, never downgraded.',
        '- There is no required number of items or importance rows. Empty arrays are valid.',
        '- conclusionTranslation: only when the conclusion summary is in a different language from LOCALE.',
        '- dataNote and invalidationNote are optional but must not repeat the lede.'
      ].join('\n')
    }
  ]
}

function dataFacts(document: DailyBriefingDocument): ReadonlyArray<{
  factId: string
  labelKey: string
  state: string
  value: Readonly<{ number: number; format: string }> | null
  change: Readonly<{ value: number; unit: string; window: string }> | null
  window: string
  must: boolean
}> {
  const rows = [
    ...document.data.market,
    ...document.data.funds,
    ...(document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : [])
  ]
  return rows.map((row) => ({
    factId: `data:${row.id}`,
    labelKey: row.labelKey,
    state: row.state,
    value: row.value ? { number: row.value.number, format: row.value.format } : null,
    change: row.change ? { value: row.change.value, unit: row.change.unit, window: row.change.window } : null,
    window: row.window,
    must: row.importance.tier === 'must'
  }))
}
