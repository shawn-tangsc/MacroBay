import type { StructuredModelMessage } from '@platform/ai/invocation/structuredModelInvocationTypes'

import type { DailyBriefingDocument, BriefingPriorConclusion } from '../../../contracts/dailyBriefing'

/**
 * The editorial prompt is bounded to the frozen document: the model may add prose and a visibility
 * ranking, never a new fact. Every fact it can name has an id in `facts`, and every number it may
 * repeat is already in that JSON.
 */
export function buildDailyBriefingPrompt(input: Readonly<{
  document: DailyBriefingDocument
  locale: 'zh-CN' | 'en-US'
  selection?: unknown
  priorConclusions?: readonly BriefingPriorConclusion[]
}>): StructuredModelMessage[] {
  const { document, locale } = input
  const facts = {
    locale,
    ...(input.selection !== undefined ? { selection: input.selection } : {}),
    previousLedePattern: document.lede.previousPattern ?? null,
    edition: { date: document.edition.date, windowStart: document.edition.windowStart, windowEnd: document.edition.windowEnd },
    conclusion: document.conclusion ? {
      direction: document.conclusion.direction,
      summary: document.conclusion.summary,
      conditions: document.conclusion.conditions,
      invalidations: document.conclusion.invalidations.map((item) => item.text),
      counterEvidence: document.conclusion.counterEvidence.map((item) => item.statement)
    } : null,
    // Oldest first, bounded by the packet collector: the editor must be able to see a flip in the
    // sequence. Each entry is a claim with its own observation instant, never a verified fact.
    priorConclusions: (input.priorConclusions ?? []).map((conclusion) => ({
      id: conclusion.id,
      source: conclusion.source,
      observedAt: conclusion.observedAt,
      asOf: conclusion.asOf,
      direction: conclusion.direction,
      confidence: conclusion.confidence,
      summary: conclusion.summary,
      ...(conclusion.rationale ? { rationale: conclusion.rationale } : {}),
      evidenceRefs: conclusion.evidenceRefs
    })),
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
    ...(document.data.leverage ? { leverage: document.data.leverage } : {}),
    ...(document.data.policyPath ? { policyPath: document.data.policyPath } : {}),
    mustFloor: dataFacts(document).filter((item) => item.must).map((item) => item.factId),
    hiddenDataFacts: dataFacts(document).filter((item) => item.visibility === 'hidden').map((item) => item.factId),
    next: [document.next.focus, ...document.next.items].filter(Boolean).map((item) => ({
      eventKey: item!.eventKey,
      title: item!.title,
      at: item!.at,
      country: item!.countryName ?? item!.countryCode ?? null,
      consensus: item!.consensus ?? null,
      previous: item!.previous ?? null,
      ...(item!.relevance ? { relevance: item!.relevance } : {}),
      focus: item!.eventKey === document.next.focus?.eventKey
    })),
    nextFocus: document.next.focus ? {
      eventKey: document.next.focus.eventKey,
      ...(document.next.focus.relevance ? { relevance: document.next.focus.relevance } : {})
    } : null
  }
  return [
    {
      role: 'system',
      content: [
        'You are the editor of a frozen daily market brief. Write in the requested locale.',
        'Return one JSON object and nothing else. Do not use markdown fences, URLs, code, or a preamble.',
        'Do not add facts, numbers, prices, targets, or buy/sell advice. Only use numbers that already appear in FACTS.',
        'Copy each number character-for-character from FACTS. Never round, recompute, or add decimal places (0.0036 must not become 0.003619).',
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
          webEvidence: [
            { eventKey: '<macro eventKey>', field: 'consensus|actual|previous|reaction', value: '<value>', sourceName: '<source>', sourceUrl: '<url from search results>', publishedAt: '<ISO timestamp>' }
          ],
          hidden: [
            { factId: 'news:<id>|macro:<key>', reason: 'one sentence, at most 200 characters' }
          ],
          importance: [
            { factId: 'data:<id>', tier: 'must|support|reference', reasonText: 'why this data fact earns a line, at most 200 characters' }
          ],
          hiddenData: [
            { factId: 'data:<id>', reason: 'why a material data fact is not shown, at most 200 characters' }
          ],
          dataNote: 'one sentence about what the numbers say, at most 240 characters',
          invalidationNote: 'one sentence about what would change the read, at most 240 characters',
          conclusionTranslation: 'only when conclusionSynthesis is omitted: translate the fallback conclusion summary, or omit',
          conclusionSynthesis: {
            direction: 'bullish|bearish|range|undecided|mixed',
            confidence: 'high|medium|low',
            summary: 'reader-facing verdict. The direction is rendered as a tag before this summary, so do NOT start with or repeat the direction label (no 偏空/偏多/震荡/结论偏空/方向偏空). Sentence 1 starts directly with the main driver (event, data or fund flow); sentences 2-3 add 2-3 direct drivers with FACTS numbers. If the read changed today, say what the market did, not what an earlier analysis thought. At most 3 sentences.',
            regimeChange: 'only when something material changed versus earlier: the market shift and the fact plus number that shows it. If nothing important changed, write "no material change" / "无重要变化". Never narrate the editing process, a window, or an earlier AI view.',
            confirmed: ['market outcome that supports the earlier read: the fact and its number, one sentence. Empty when not worth mentioning'],
            refuted: ['market outcome that contradicts the earlier read: the fact and its number, one sentence. Empty when not worth mentioning'],
            coreTension: 'the live contradiction in market terms: which buyers/sellers, prices or flows disagree right now. No bare labels.',
            whatWouldChange: 'the specific observable (price, flow or print) that would overturn this read; include the number from FACTS',
            evidenceRefs: ['news:<id>|macro:<key>|data:<id>']
          },
          nextFocus: {
            eventKey: 'FACTS.nextFocus.eventKey',
            why: 'the BTC/ETH transmission of this event and why it, not the nearest event, is the focus, at most 200 characters',
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
        '- importance: the data: factIds you decide to show, unique, must/support/reference. Every listed data row becomes visible. A mustFloor row is always shown; keep it out of hiddenData.',
        '- hiddenData: for every data: fact whose materiality.material is true that you do NOT show, give one sentence explaining why. Omit immaterial rows: the rule already hides them with reason no-material-change.',
        '- data:leverage and data:policy-path are selectable only when materiality.material is true. Below the threshold they cannot be shown, whatever the ranking says. A flat open interest, a rate path that has not moved, and a row with no change are context, not news.',
        '- Include a data fact only when it has a material change or explains today’s read; every hidden data fact is audited with a reason, never silently dropped.',
        '- conclusionTranslation: only when conclusionSynthesis is omitted and the fallback conclusion summary is in a different language from LOCALE. When you write conclusionSynthesis, omit it: the synthesized summary is already in LOCALE.',
        '- conclusionSynthesis: required when FACTS.priorConclusions is not empty; omit it when the list is empty (the fact-layer conclusion stays as a marked fallback). Weigh the prior conclusions against today’s facts and write your own verdict for a reader who never saw an earlier draft: what the market did and how you read it now. Never copy any prior conclusion’s wording, sentence or structure; a verbatim or near-verbatim copy is rejected. Never describe the editing process, a window, frozen data, earlier AI views, models, documents called conclusions, or a timeline.',
        '- priorConclusions are claims, not facts: do not repeat their numbers as if verified and do not cite them as evidence. Cite only frozen news:/macro:/data: factIds in conclusionSynthesis.evidenceRefs, at least one. Never mention their observedAt/asOf clock times.',
        '- summary opens with one sentence of direction, then 2-3 direct drivers. Each driver names the event, data point or fund flow and carries its number from FACTS (actual vs consensus, the 24h move, the net flow). A direction without a driver, or a driver without a number, is not a conclusion.',
        '- If today’s facts changed the read, write the market action that changed it: "盘中一度转多，但 ETF 流出 1.2 亿美元，判断回到偏空" / "it briefly turned bid, but the ETF outflow took the bounce back to bearish". Name the move and the flow or number that reversed it. Never write "the view flipped during the window", "most calls", or a clock time.',
        '- confirmed/refuted describe market outcomes, not an analyst scorecard: each entry names the earlier read and the fact plus number that confirmed or contradicted it. Leave them empty when the earlier read is not worth mentioning; never pad them with a chronology of views. coreTension is the live contradiction a trader must price now, not a summary of the lede. whatWouldChange is a specific, observable threshold with a number.',
        '- BANNED in conclusionSynthesis (the validator rejects them): 窗口/窗口内, 多数判断, 冻结数据, 前提被削弱, AI, 模型, 结论, 时间线; English window, most calls, frozen data, premise weakened, AI, model, conclusion, timeline. Also banned: clock times such as 23:09 unless they are a scheduled market event named in the same sentence (for example "20:30 CPI"), and bare 分化/承压/风险偏好/流动性 or divergence/under pressure/risk appetite/liquidity with no concrete object or number in the same sentence. Do not stack jargon.',
        '- dataNote and invalidationNote are optional but must not repeat the lede.',
        '- webEvidence is optional; only add entries actually seen in this turn’s WebSearch/WebFetch results. The URL and publishedAt must match a tool result; never invent a source. Local official actual overrides a web value.',
        '- items are shown facts with why; hidden contains every other candidate with a reason. items + hidden must cover every news and macro candidate exactly once.',
        '- Every shown macro needs a why. A macro without a why is not shown; do not list one in items and leave its explanation to be inferred.',
        '- A macro fact without consensus is not automatically shown and not automatically hidden: select it when its actual vs previous move matters, and hide it with a relevance, repetition or low-impact reason when it does not. Missing consensus is a data gap, never the reason an event is unimportant. When shown, its why must compare actual with previous by value.',
        '- The lede is event-first: lead with the dominant event/tension and its transmission, not with a direction or a data recital. Never enumerate the news headlines or the data rows. Avoid generic openers such as “market sentiment is cautious” or “mixed signals”.',
        '- nextFocus: the focus was chosen in the selection stage. Keep its eventKey and explain its transmission to BTC/ETH, not merely that it is scheduled or important; then give 2-3 if/then implications. Use only numbers in FACTS.'
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
  materiality: Readonly<{ material: boolean; reasonCode: string }> | null
  visibility: 'shown' | 'hidden'
}> {
  const rows = [
    ...document.data.market,
    ...document.data.funds,
    ...(document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : [])
  ]
  return [
    ...rows.map((row) => ({
      factId: `data:${row.id}`,
      labelKey: row.labelKey,
      state: row.state,
      value: row.value ? { number: row.value.number, format: row.value.format } : null,
      change: row.change ? { value: row.change.value, unit: row.change.unit, window: row.change.window } : null,
      window: row.window,
      must: row.importance.tier === 'must',
      materiality: row.materiality ?? null,
      visibility: row.visibility ?? 'shown' as const
    })),
    ...(document.data.leverage ? [{
      factId: 'data:leverage',
      labelKey: 'dailyBriefing.row.leverage',
      state: document.data.leverage.state,
      value: null,
      change: null,
      window: '24h',
      must: false,
      materiality: document.data.leverage.materiality ?? null,
      visibility: document.data.leverage.visibility ?? 'shown' as const
    }] : []),
    ...(document.data.policyPath ? [{
      factId: 'data:policy-path',
      labelKey: 'dailyBriefing.row.policyPath',
      state: document.data.policyPath.state,
      value: { number: document.data.policyPath.probability, format: 'percent' },
      change: null,
      window: 'latest',
      must: false,
      materiality: document.data.policyPath.materiality ?? null,
      visibility: document.data.policyPath.visibility ?? 'shown' as const
    }] : [])
  ]
}

/** Stage 1: the editor chooses which candidates matter and which fields it needs. */
export function buildDailyBriefingSelectionPrompt(input: Readonly<{
  document: DailyBriefingDocument
  locale: 'zh-CN' | 'en-US'
}>): StructuredModelMessage[] {
  const { document, locale } = input
  const candidates = {
    news: document.news.items.map((item) => ({ factId: `news:${item.itemId}`, title: item.translatedTitle ?? item.title, source: item.sourceName })),
    macro: document.news.macro.map((item) => ({ factId: `macro:${item.eventKey}`, title: item.title, actual: item.actual ?? null, consensus: item.consensus ?? null, previous: item.previous ?? null })),
    data: dataFacts(document).map((item) => ({
      factId: item.factId,
      labelKey: item.labelKey,
      state: item.state,
      value: item.value,
      change: item.change,
      window: item.window,
      must: item.must,
      materiality: item.materiality,
      visibility: item.visibility
    })),
    ...(document.data.leverage ? { leverage: document.data.leverage } : {}),
    ...(document.data.policyPath ? { policyPath: document.data.policyPath } : {}),
    next: (document.next.candidates ?? [document.next.focus, ...document.next.items]).filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => ({ eventKey: item.eventKey, title: item.title, at: item.at, category: item.category, consensus: item.consensus ?? null, previous: item.previous ?? null, ...(item.relevance ? { relevance: item.relevance } : {}) }))
  }
  return [
    { role: 'system', content: 'You are the editor of a frozen daily market brief. Select, do not write prose yet. Return one JSON object and nothing else.' },
    { role: 'user', content: [
      `LOCALE: ${locale}`,
      'CANDIDATES:',
      JSON.stringify(candidates, null, 2),
      'Return this exact shape: {"stage":"select","focus":"<next eventKey>","focusWhy":"why it transmits to BTC/ETH","next":["<eventKey>"],"macro":["macro:<key>"],"news":["news:<id>"],"data":["data:<id>"],"requests":[{"factId":"<factId>","fields":["consensus","previous"]}],"hidden":[{"factId":"<factId>","reason":"why not shown"}],"hiddenData":[{"factId":"data:<id>","reason":"why not shown"}]}',
      'Select only from the lists. Keep next/macro/news/data IDs exact. Choose one next focus plus at most 3 other next events, at most 4 macro and 6 news that actually change the day; do not select everything. macro: the 24h section is capped at four releases, so choose the ones a BTC/ETH trader needs, not every high-impact print: prefer the day’s key release, the events most relevant to crypto transmission, and the largest actual-vs-previous changes. data: show only rows with a material change or an explanatory role; leverage and policy-path are selectable only when materiality.material is true, and floor rows (must=true) are always shown. requests may ask for missing fields; do not invent values. List every unselected news/macro/next candidate in hidden with a reason; list a material data row you deliberately leave out in hiddenData with a reason (immaterial rows are already hidden by the rule).',
      'NO CONSENSUS IS NOT ITSELF A HIDING REASON: a released event without consensus is not automatically selected and not automatically hidden. Select it when its actual vs previous move matters and explain that comparison in the writing pass; otherwise hide it with a relevance, repetition or low-impact reason. Never use "no consensus" as the reason an event does not matter.',
      'NEXT FOCUS: choose the candidate whose transmission to BTC/ETH is strongest today, not simply the nearest event. The relevance field gives the channel and its default weight (rate-policy, inflation, labor, liquidity, ETF flows, regulation, stablecoins, exchange risk rank above Asia/commodity spillovers). A lower-ranked event such as China PMI or OPEC is allowed only when focusWhy states the concrete Asia or commodity transmission to BTC/ETH. focusWhy is required with focus and must name the channel or asset; a missing/unknown eventKey or a why with no BTC/ETH transmission is ignored and the deterministic relevance ranking becomes the focus.',
      'NEXT LIST: after the focus, choose at most 3 other events, ordered by relevance then time. Do not fill the list chronologically; the list is relevance-first. The focus plus those 3 is the 4-event cap.'
    ].join('\n') }
  ]
}
