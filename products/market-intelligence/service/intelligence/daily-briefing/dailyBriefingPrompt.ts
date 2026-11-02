import type { StructuredModelMessage } from '@platform/ai/invocation/structuredModelInvocationTypes'

import type { DailyBriefingDocument, BriefingPriorConclusion } from '../../../contracts/dailyBriefing'
import {
  formatBriefingChangeDisplay,
  formatBriefingValueDisplay,
  formatPercentDisplay
} from './dailyBriefingFactDisplay'

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
  const rowFacts = dataFacts(document, locale)
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
    data: rowFacts,
    ...(document.data.leverage ? { leverage: document.data.leverage } : {}),
    ...(document.data.policyPath ? {
      policyPath: {
        ...document.data.policyPath,
        probabilityDisplay: formatPercentDisplay(document.data.policyPath.probability)
      }
    } : {}),
    mustFloor: rowFacts.filter((item) => item.must).map((item) => item.factId),
    hiddenDataFacts: rowFacts.filter((item) => item.visibility === 'hidden').map((item) => item.factId),
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
        'Do not add facts or numbers, and never write a price target, a trade instruction, or an invented probability. Directional forecasts and conditional statements are required.',
        'Every number you write must be copied character-for-character from a FACTS `display` field (or `changeDisplay`/`probabilityDisplay`). Never format, scale, round or convert a raw value yourself.',
        'The FACTS `value`/`change.value` numbers are stored raw values for reasoning only; they are not prose spellings and must never appear in the output. A 9-digit raw amount, a percentage with more than two decimals, or a Chinese 亿 next to an English billion is rejected.',
        'Two assets that display the same are not equal: BTC and ETH can both print +0.50% while their `value` numbers differ. Never claim they are the same, matched, in line, or that one leads, from the two-decimal display; compare the raw `value` numbers and say which is stronger.',
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
            summary: 'Analyst prose in 2-4 sentences: the mechanism chain — what changed → through which channel → pressure or support for BTC/ETH (use 因为/导致/通过 or because/leads to/through) — plus the call it lands on. The base case, the catalysts and the overturn threshold are rendered as their own lines under the summary, so do NOT restate them here. The direction is already rendered as a tag before this summary, so do NOT start with or repeat the direction label (no 偏空/偏多/震荡/结论偏空/方向偏空). A recital of data without a causal link is not a conclusion. At most 600 characters.',
            outlook: 'Next one to three sessions: state the base case explicitly as 偏多/偏空/震荡 (bullish/bearish/range), then BTC versus ETH relative strength (强于/弱于/跑赢/跑输 or outperform/underperform). Use only FACTS display numbers.',
            conditions: ['premise this forecast needs: the observable market state that must hold, with its FACTS display value; 1-3 items. Derived from this forecast, never copied from the earlier analysis conclusion.'],
            counterEvidence: ['falsifier for this forecast: 若/if + observable threshold + what it would mean for BTC/ETH; 1-3 items, each with a FACTS display number. Replaces the earlier analysis counter-evidence.'],
            watch: ['catalyst or indicator to watch next (ETF flow, funding, stablecoins, NFP/CPI, the next release), with its FACTS display number; 1-4 items'],
            regimeChange: 'a marker, not a paragraph: at most 48 characters (one short phrase) saying whether the call changed and what flipped it, for example "方向由偏多转为偏空" / "turned bearish". If nothing important changed, write "no material change" / "无重要变化" — it is shown as a chip, never as a sentence. Never narrate the editing process, a window, or an earlier AI view.',
            confirmed: ['market outcome that supports the earlier read: the fact and its number, one sentence. Empty when not worth mentioning'],
            refuted: ['market outcome that contradicts the earlier read: the fact and its number, one sentence. Empty when not worth mentioning'],
            coreTension: 'the live contradiction in market terms: which buyers/sellers, prices or flows disagree right now. No bare labels.',
            whatWouldChange: 'the single clearest observable threshold that would overturn the base case, with the number from FACTS',
            evidenceRefs: ['news:<id>|macro:<key>|data:<id>', 'at most 8, most important first: the few facts the call actually rests on, not every fact you were given']
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
        '- conclusionSynthesis: required when FACTS.priorConclusions is not empty; omit it when the list is empty (the fact-layer conclusion stays as a marked fallback). Weigh the prior conclusions against today’s facts and write your own forward verdict for a reader who never saw an earlier draft. Never copy any prior conclusion’s wording, sentence or structure; a verbatim or near-verbatim copy is rejected. Never describe the editing process, a window, frozen data, earlier AI views, models, documents called conclusions, or a timeline.',
        '- priorConclusions are claims, not facts: do not repeat their numbers as if verified and do not cite them as evidence. Cite only frozen news:/macro:/data: factIds in conclusionSynthesis.evidenceRefs, at least one. Never mention their observedAt/asOf clock times.',
        '- summary is an analyst view, not a recap: it must state the mechanism chain (what changed → through which channel → pressure or support for BTC/ETH) and the call it lands on, in at least two sentences, written with 因为/导致/通过 or because/leads to/through. A summary with no mechanism connective or fewer than two sentences is rejected.',
        '- outlook is the base case itself: 偏多/偏空/震荡 (bullish/bearish/range) plus BTC versus ETH relative strength. conditions are the premises the base case needs; counterEvidence are the falsifiers, each a conditional (若/if) with a FACTS display number. Never reuse the earlier analysis conclusion’s conditions, invalidations or counter-evidence: they describe a different call and horizon. watch lists 1-4 catalysts or indicators with their display numbers (ETF flow, funding, stablecoins, NFP/CPI, the next release).',
        '- Each point appears exactly once on the page: summary carries the mechanism, outlook the next-1-3-day base case, watch the catalysts, whatWouldChange the single overturn threshold. Repeating one of those sentences inside summary (or a falsifier inside whatWouldChange) is rejected as duplicate content.',
        '- Price targets, buy/sell advice and invented probabilities are rejected: no 目标价/目标位/上看/下看/止损/止盈, no price target/target price/stop loss/take profit, no 建议买入/卖出/加仓/减仓, no "70% 概率". Directional predictions and conditionals ("若 ... 则 ..." / "if ... then ...") are required instead.',
        '- Numbers: quote the FACTS `display` field exactly. Percentages keep two decimals; Chinese USD uses 亿/万美元; English USD uses $B/$M; never write a raw 9-digit amount, a percentage with more than two decimals, or mix billion/million with 亿. Example: ETF net flow -6.43 亿美元 / -$643.2M; BTC 24h -0.83%.',
        '- If today’s facts changed the read, write the market action that changed it: "盘中一度转多，但 ETF 流出 -6.43 亿美元，判断回到偏空" / "it briefly turned bid, but the ETF outflow of -$643.2M took the bounce back to bearish". Name the move and the flow or number that reversed it. Never write "the view flipped during the window", "most calls", or a clock time.',
        '- confirmed/refuted describe market outcomes, not an analyst scorecard: each entry names the earlier read and the fact plus number that confirmed or contradicted it. They are rendered as one short "basis held / basis was overturned" line, so keep each entry to a clause, not a paragraph, and leave them empty when the earlier read is not worth mentioning; never pad them with a chronology of views. coreTension is the live contradiction a trader must price now, not a summary of the lede. whatWouldChange is the single clearest observable threshold with a display number, and it must not repeat a counterEvidence entry.',
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

function dataFacts(document: DailyBriefingDocument, locale: 'zh-CN' | 'en-US'): ReadonlyArray<{
  factId: string
  labelKey: string
  state: string
  value: Readonly<{ number: number; format: string }> | null
  change: Readonly<{ value: number; unit: string; window: string }> | null
  /** The only prose spelling of `value` the model may quote. */
  display: string | null
  /** The only prose spelling of `change` the model may quote. */
  changeDisplay: string | null
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
      display: formatBriefingValueDisplay(row.value, locale),
      changeDisplay: formatBriefingChangeDisplay(row.change, locale),
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
      display: null,
      changeDisplay: null,
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
      display: formatPercentDisplay(document.data.policyPath.probability),
      changeDisplay: null,
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
    data: dataFacts(document, locale).map((item) => ({
      factId: item.factId,
      labelKey: item.labelKey,
      state: item.state,
      value: item.value,
      change: item.change,
      display: item.display,
      changeDisplay: item.changeDisplay,
      window: item.window,
      must: item.must,
      materiality: item.materiality,
      visibility: item.visibility
    })),
    ...(document.data.leverage ? { leverage: document.data.leverage } : {}),
    ...(document.data.policyPath ? {
      policyPath: {
        ...document.data.policyPath,
        probabilityDisplay: formatPercentDisplay(document.data.policyPath.probability)
      }
    } : {}),
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

/**
 * The sentence the model reads after its reply was rejected.
 *
 * The reason has to travel in this text: the model cannot read our logs, so a detail recorded only
 * there leaves the next attempt guessing — the loop that produced three identical failures in one
 * evening (MI-2-R16).
 */
export function repairPromptFor(failureCode: string, failureDetail: string | undefined): string {
  return `Your previous JSON failed validation: ${failureCode}${failureDetail ? ` (${failureDetail})` : ''}. Rewrite the full JSON using only facts from the prompt.`
}
