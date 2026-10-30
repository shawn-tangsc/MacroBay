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
    mustFloor: dataFacts(document).filter((item) => item.must).map((item) => item.factId),
    next: [document.next.focus, ...document.next.items].filter(Boolean).map((item) => ({
      eventKey: item!.eventKey,
      title: item!.title,
      at: item!.at,
      country: item!.countryName ?? item!.countryCode ?? null,
      consensus: item!.consensus ?? null,
      previous: item!.previous ?? null
    }))
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
          lede: '2-3 sentences led by the day’s dominant event or tension. Do not recite the data table or the headlines. No numbers outside FACTS.',
          ledePattern: 'event-shock|surprise-gap|tension|structure|setup|outlier|falsification',
          items: [
            { factId: 'news:<id>', why: 'one sentence, at most 200 characters' },
            { factId: 'macro:<key>', why: 'one sentence, at most 200 characters' }
          ],
          importance: [
            { factId: 'data:<id>', tier: 'must|support|reference', reasonText: 'one short sentence, at most 200 characters' }
          ],
          dataNote: 'one sentence about what the numbers say, at most 240 characters',
          invalidationNote: 'one sentence about what would change the read, at most 240 characters',
          conclusionTranslation: 'translate the conclusion summary only, or omit',
          nextFocus: {
            eventKey: 'the focus eventKey from FACTS.next',
            why: 'why this event matters for the current read, at most 200 characters',
            watch: [
              { condition: 'higher than expected', implication: 'what follows for rates, dollar and BTC/ETH' },
              { condition: 'lower than expected', implication: 'what follows for rates, dollar and BTC/ETH' }
            ]
          }
        }, null, 2),
        '',
        'RULES:',
        '- Act as a crypto trading analyst writing for BTC/ETH: for every candidate news:/macro: fact, decide whether a trader needs it today. Return one item (with why) for each fact you decide to show; omit the rest. There is no fixed count and no quota. Omit generic, duplicate, low-signal or already-known items.',
        '- items: only news:/macro: factIds, no duplicates, order by importance. An empty array is valid only when nothing is worth showing.',
        '- importance: only data: factIds, unique, must/support/reference. The mustFloor rows may be lifted or kept, never downgraded.',
        '- There is no required number of items or importance rows. The model, not a cap, decides visibility.',
        '- conclusionTranslation: only when the conclusion summary is in a different language from LOCALE.',
        '- dataNote and invalidationNote are optional but must not repeat the lede.',
        '- The lede is event-first: lead with the dominant event/tension and its transmission, not with a direction or a data recital. Never enumerate the news headlines or the data rows. Avoid generic openers such as “market sentiment is cautious” or “mixed signals”.',
        '- nextFocus: only for the next event list. Explain why the focus matters, then 2-3 if/then implications. Use only numbers in FACTS.'
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
