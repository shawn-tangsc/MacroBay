import type {
  BriefingConclusion,
  BriefingCounterEvidence,
  BriefingMacroItem,
  BriefingNewsItem,
  BriefingNewsSummary,
  BriefingNextItem,
  BriefingNextRelevance,
  BriefingNextRelevanceRole,
  BriefingTopSignal,
  DailyBriefingDocument,
  DailyBriefingReadingId,
  DailyBriefingReadingState
} from '../../../contracts/dailyBriefing'
import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import { indicatorNameOf } from '../../../contracts/indicatorNames'
import type { DirectionAdvice } from '../../../contracts/marketAnalysisContracts'
import { buildBriefingReadingRows, type FearGreedBaseline } from './dailyBriefingMarketRows'
import { buildLeverageBlock, buildPolicyPathBlock } from './dailyBriefingDataBlocks'
import { proseLanguageBreach } from './dailyBriefingProseLanguage'
import { macroEmptyCode, macroEmptyHours, newsEmptyCode, nextEmptyCode } from './dailyBriefingEmptyCodes'
import { briefingEventInNextWindow } from './dailyBriefingCalendarWindow'
import { selectTier1UpcomingReleases } from './dailyBriefingTier1Upcoming'
import { toBriefingNewsItem } from './dailyBriefingNewsItem'
import {
  highImpactEventsInWindow,
  maximumBriefingMacroItems,
  selectBriefingMacroItems,
  selectMacro,
  selectMacroCandidates,
  selectMacroFloorItem
} from './dailyBriefingDocumentMacro'

// 选取口径原本就在这个文件里、被外部 import：搬家不改调用方。
export { maximumBriefingMacroItems, selectBriefingMacroItems, selectMacroFloorItem } from './dailyBriefingDocumentMacro'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * 这一版算不算「补跑」：运行时刻明显晚于它的统计截止。
 *
 * 留 5 分钟容差：定时触发在整点后几秒到几分钟内起跑，那是准点，不是补跑；把准点写成补跑会让每一版
 * 都多一句"数据截至"的说明，读者会以为所有版次都是事后补的。
 */
export const BRIEFING_BACKFILL_TOLERANCE_MS = 5 * 60 * 1_000

export function briefingRunIsBackfill(input: Readonly<{ readAt: string; cutoff: string }>): boolean {
  const read = Date.parse(input.readAt)
  const cutoff = Date.parse(input.cutoff)
  if (!Number.isFinite(read) || !Number.isFinite(cutoff)) return false
  return read - cutoff > BRIEFING_BACKFILL_TOLERANCE_MS
}

export function buildDailyBriefingDocument(input: Readonly<{
  packet: DailyBriefingFactPacket
  date: string
  previous?: DailyBriefingDocument
}>): DailyBriefingDocument {
  const { packet, date } = input
  const readings = buildBriefingReadingRows(packet, previousFearGreedBaseline(packet, input.previous))
  const news = selectNews(packet)
  const macroCandidates = selectMacroCandidates(packet, new Set(packet.macroWebValueKeys ?? []))
  const macro = selectMacro(packet, macroCandidates)
  // 宏观那一栏空的时候说什么，一次算清：句子、过期几小时、有事件但没值的条数。
  const macroEmpty = macro.length > 0 ? undefined : macroEmptyCode(packet)
  // 窗口里到底有多少条高影响事件（不看有没有值）。版面不再印"几条没拿到"（用户 2026-11-06），
  // 所以只留总数；缺值这件事由事实本身表达——事件行在、值格不渲染。
  const highImpact = highImpactEventsInWindow(packet)
  const macroTotals = highImpact.length === 0 ? {} : { macroHighImpactCount: highImpact.length }
  const macroEmptyNotes = macroEmpty === undefined ? {} : {
    macroEmpty,
    // The stale sentence names the age; nothing else can fill it truthfully, and the number
    // rides beside the code rather than inside it so the copy stays in the text table.
    ...(macroEmpty === 'calendar-stale' && macroEmptyHours(packet) !== undefined
      ? { macroEmptyHours: macroEmptyHours(packet)! }
      : {})
  }
  const nextCandidates = selectNextCandidates(packet)
  const next = selectNext(packet, nextCandidates)
  const tier1Upcoming = tier1UpcomingForUnratedWeek(packet)
  const built = buildConclusion(packet)
  const policyBlock = buildPolicyPathBlock(packet, input.previous)
  const policyPathData = policyBlock.policyPath
  const leverage = buildLeverageBlock(packet, readings.funds)
  const document: DailyBriefingDocument = Object.freeze({
    // Read from the policy rather than repeating the literals: a version bump that updates only one
    // of the two makes every read look stale, and the brief is regenerated on every poll.
    schemaVersion: dailyBriefingPolicy.schemaVersion,
    policyVersion: dailyBriefingPolicy.policyVersion,
    edition: Object.freeze({
      date,
      locale: packet.locale,
      // Identity travels with the edition, not with a configuration row: a deleted period must still
      // say which one it was. Taken from the packet the run was built for; a run that never said
      // which period it belonged to is this version's single fixed period.
      periodId: packet.periodId ?? 'default',
      // The nominal cutoff: for a scheduled period this is the configured generation time, which is
      // exactly where the window ends. `generatedAt` below is the actual moment the run finished.
      periodTime: packet.periodTime ?? packet.windowEnd,
      periodKind: packet.periodKind ?? 'scheduled',
      runTrigger: packet.runTrigger ?? 'scheduled',
      // `generatedAt` 是"这一版真的什么时候跑出来的"：`packet.asOf` 现在是运行时刻，不是截止。
      generatedAt: packet.asOf,
      // 三个字段一起写（`A0.10`）：哪一刻读的世界（`readAt`）、什么时候跑出来的（`generatedAs`）、
      // 这次是不是补跑。两个时刻取同一瞬间——一次跑只有一个时钟，分两个会互相对不上。
      // 不写 `dataAsOf`：那是旧名，旧义是"统计截止"，重名会让旧版次被误读。
      readAt: packet.asOf,
      generatedAs: packet.asOf,
      ...(briefingRunIsBackfill({ readAt: packet.asOf, cutoff: packet.periodTime ?? packet.windowEnd })
        ? { isBackfill: true }
        : {}),
      windowStart: packet.windowStart,
      windowEnd: packet.windowEnd,
      // Written from the packet, never recomputed from the current setting: a later settings change
      // must not reinterpret an edition that already exists.
      windowHours: packet.windowHours,
      timeZone: packet.timeZone
    }),
    status: buildStatus(packet, readings),
    lede: Object.freeze({
      source: 'template' as const,
      text: '',
      ...(input.previous?.lede.pattern ? { previousPattern: input.previous.lede.pattern } : {}),
      factCount: 0,
      generatedAt: packet.asOf
    }),
    news: Object.freeze({
      items: news,
      macro,
      ...(macroCandidates.length > 0 ? { macroCandidates } : {}),
      // 来源静默/连续失败（schema 15）：右列只读文档，所以这件事必须冻在文档里。
      ...(packet.newsSources === undefined || packet.newsSources.length === 0 ? {} : { sources: packet.newsSources }),
      notes: Object.freeze({
        ...(news.length > 0 ? {} : { newsEmpty: newsEmptyCode(packet) }),
        ...(macroEmpty === undefined ? {} : macroEmptyNotes),
        ...macroTotals,
        ...(packet.macroValueConflicts === undefined || packet.macroValueConflicts.length === 0
          ? {}
          : { macroValueConflicts: packet.macroValueConflicts })
      })
    }),
    data: Object.freeze({
      market: readings.market,
      funds: readings.funds,
      ...(leverage ? { leverage } : {}),
      ...(policyPathData ? { policyPath: policyPathData } : {}),
      sentiment: Object.freeze({
        fearGreed: readings.fearGreed,
        news: newsSummary(packet)
      })
    }),
    conclusion: built.conclusion,
    next: Object.freeze({
      items: next.items,
      ...(next.focus ? { focus: next.focus } : {}),
      ...(nextCandidates.length > 0 ? { candidates: nextCandidates } : {}),
      ...(next.items.length > 0 || next.focus ? {} : { note: nextEmptyCode(packet) }),
      // 「整周有事件、但一条已分级的都没有」时，除了那句「我们还没分级」，还要给读者真实排期
      // （R44 §6.2）。排期是我们自己的一级清单，不是「高影响事件」——两者不混。
      ...(tier1Upcoming.length > 0 ? { tier1Upcoming } : {})
    }),
    citations: built.citations,
    provenance: Object.freeze({
      summaryId: packet.conclusion?.summary.id ?? null,
      readAt: packet.asOf,
      ...(policyBlock.audit.length > 0 ? { dataAudit: policyBlock.audit } : {})
    })
  })
  return input.previous ? Object.freeze({ ...document, comparison: buildComparison(document, input.previous) }) : document
}

/**
 * The publication fear-and-greed moved from.
 *
 * Fear-and-greed is a release, not a daily source: it publishes when it publishes, and the brief may
 * skip a day (the app was closed) without that absence erasing the comparison. So the baseline is the
 * score the last stored edition read — whatever its date — provided it is an earlier publication. An
 * edition that read the same publication is not a second value, and a missing score stays
 * `no-baseline` rather than being filled with a zero.
 */
function previousFearGreedBaseline(
  packet: DailyBriefingFactPacket,
  previous: DailyBriefingDocument | undefined
): FearGreedBaseline | undefined {
  const row = previous?.data.sentiment.fearGreed
  const score = row?.value?.number
  if (!previous || !row || typeof score !== 'number' || !Number.isFinite(score)) return undefined
  // Older editions may predate `observedAt` on the row; the edition's own date is then the only
  // publication stamp there is, and it is still earlier than today's.
  const publishedAt = row.observedAt ?? `${previous.edition.date}T00:00:00.000Z`
  const current = packet.readings.fearGreed.state === 'available' ? packet.readings.fearGreed.observedAt : undefined
  if (current && publishedAt >= current) return undefined
  return Object.freeze({ score, publishedAt })
}

function buildComparison(current: DailyBriefingDocument, previous: DailyBriefingDocument): DailyBriefingDocument['comparison'] {
  const value = (document: DailyBriefingDocument, id: string) =>
    document.data.funds.find((row) => row.id === id)?.value?.number ?? document.data.market.find((row) => row.id === id)?.value?.number
  const btcFunding = value(current, 'funding-btc'); const previousFunding = value(previous, 'funding-btc')
  const stablecoin = value(current, 'stablecoin'); const previousStablecoin = value(previous, 'stablecoin')
  const etfBtc = value(current, 'etf-btc'); const previousEtfBtc = value(previous, 'etf-btc')
  const currentDirection = current.conclusion?.direction
  const previousDirection = previous.conclusion?.direction
  const previousMacro = new Set(previous.news.macro.map((item) => item.eventKey))
  return Object.freeze({
    previousDate: previous.edition.date,
    directionChanged: currentDirection !== previousDirection,
    ...(previousDirection ? { previousDirection } : {}),
    ...(btcFunding !== undefined && previousFunding !== undefined ? { fundingBtcDelta: btcFunding - previousFunding } : {}),
    ...(stablecoin !== undefined && previousStablecoin !== undefined ? { stablecoinDelta: stablecoin - previousStablecoin } : {}),
    ...(etfBtc !== undefined && previousEtfBtc !== undefined ? { etfBtcDelta: etfBtc - previousEtfBtc } : {}),
    newMacroEvents: current.news.macro.filter((item) => !previousMacro.has(item.eventKey)).length
  })
}

function selectNews(packet: DailyBriefingFactPacket): readonly BriefingNewsItem[] {
  const seen = new Set<string>()
  return Object.freeze(packet.news.items
    .filter((item) => item.polarity !== 'neutral' && item.strength >= 2 && item.confidence >= 50)
    .sort((left, right) =>
      right.strength * right.confidence - left.strength * left.confidence ||
      right.publishedAt.localeCompare(left.publishedAt))
    .filter((item) => {
      const key = normalizeTitle(item.displayTitle ?? item.title)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, dailyBriefingPolicy.maximumNewsItems)
    .map((item) => toBriefingNewsItem(item, packet.locale)))
}

const nextRelevanceByRole: Readonly<Record<BriefingNextRelevanceRole, Readonly<{ score: number; reasonCode: string }>>> = Object.freeze({
  // A crypto desk prices policy first: the fed funds path sets the discount rate and the dollar for
  // both assets. Inflation, ETF flows and stablecoin supply are the next direct channels; regional
  // growth (China PMI) and commodity supply (OPEC) only transmit through a second step.
  'rate-policy': Object.freeze({ score: 100, reasonCode: 'policy-rate-path' }),
  'exchange-risk': Object.freeze({ score: 98, reasonCode: 'exchange-counterparty-risk' }),
  inflation: Object.freeze({ score: 94, reasonCode: 'inflation-discount-rate' }),
  etf: Object.freeze({ score: 92, reasonCode: 'etf-flow' }),
  stablecoin: Object.freeze({ score: 90, reasonCode: 'stablecoin-liquidity' }),
  labor: Object.freeze({ score: 88, reasonCode: 'labor-wage-growth' }),
  regulation: Object.freeze({ score: 86, reasonCode: 'crypto-regulation' }),
  liquidity: Object.freeze({ score: 78, reasonCode: 'dollar-liquidity' }),
  'asia-risk': Object.freeze({ score: 45, reasonCode: 'asia-growth-spillover' }),
  commodity: Object.freeze({ score: 40, reasonCode: 'commodity-inflation-spillover' })
})

type NextRelevanceInput = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  countryCode?: string
}>

/**
 * The deterministic crypto-relevance read of one scheduled event.
 *
 * Matching is on the provider's English key, not on display prose, so a translated title does not
 * change the ranking. The role is the event's transmission channel; the score orders the next list
 * and is the fallback focus when the editor does not choose one.
 *
 * **认不出的角色返回 `undefined`，不给兜底**（用户 2026-11-16）：曾经这里默认落
 * `liquidity`（78 分），于是「英伟达全员会」拿到「美元流动性」的分数——把「我没认出来」
 * 伪装成「我认出来了」。没有角色的行不占「接下来」的席位，不给分。
 */
export function scoreBriefingNextRelevance(event: NextRelevanceInput): BriefingNextRelevance | undefined {
  const text = `${event.eventKey} ${event.titleKey ?? ''} ${event.title}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const role = classifyNextEvent(text, event.countryCode)
  if (role === undefined) return undefined
  const weights = nextRelevanceByRole[role]
  return Object.freeze({ role, score: weights.score, reasonCode: weights.reasonCode })
}

function classifyNextEvent(text: string, countryCode: string | undefined): BriefingNextRelevanceRole | undefined {
  if (/(?:^| )etfs?(?: |$)|spot bitcoin|spot ether|spot crypto|grayscale|ishares/.test(text)) return 'etf'
  if (/stablecoin|usdt|usdc|tether|depeg|circle/.test(text)) return 'stablecoin'
  if (/exchange hack|hacked|exploit|insolven|bankrupt|withdrawal (?:halt|freeze)|outage|delist|binance|coinbase|kraken|okx|bybit/.test(text)) return 'exchange-risk'
  if (/(?:^| )sec(?: |$)|cftc|regulat|lawsuit|enforcement|crypto (?:bill|law)|legislation|(?:^| )ban(?: |$)/.test(text)) return 'regulation'
  if (/(?:^| )fomc(?: |$)|federal reserve|(?:^| )fed(?: |$)|rate decision|interest rate|rate hike|rate cut|ecb|bank of japan|(?:^| )boj(?: |$)|bank of england|(?:^| )boe(?: |$)|美联储|联储|利率|议息/.test(text)) return 'rate-policy'
  // PMI alone is not automatically Asian: US ISM PMI transmits through the dollar like any other
  // growth print. China (and the region's own policy/credit events) is the `asia-risk` role.
  if (countryCode === 'CN' || /(?:^| )china(?: |$)|(?:^| )cn(?: |$)|caixin|pboc|hong kong|taiwan|evergrande|中国|采购经理/.test(text)) return 'asia-risk'
  if (/(?:^| )cpi(?: |$)|(?:^| )pce(?: |$)|inflation|consumer price|producer price|(?:^| )ppi(?: |$)|hicp|通胀|物价/.test(text)) return 'inflation'
  if (/non ?farm|payroll|unemployment|jobless|employment|average hourly|wage|(?:^| )adp(?: |$)|(?:^| )nfp(?: |$)|jolts|非农|就业|失业|时薪/.test(text)) return 'labor'
  if (/treasury (?:auction|refunding)|(?:^| )(?:note|bond) auction(?: |$)|auction|debt ceiling|(?:^| )repo(?: |$)|balance sheet|(?:^| )qt(?: |$)|(?:^| )qe(?: |$)|(?:^| )tga(?: |$)|liquidity|流动性|拍卖/.test(text)) return 'liquidity'
  if (/(?:^| )opec|crude|(?:^| )oil(?: |$)|natural gas|commodit|欧佩克|石油|原油/.test(text)) return 'commodity'
  // 认不出来就是认不出来：不给角色、不给分（见 `scoreBriefingNextRelevance` 的注释）。
  return undefined
}

/**
 * Relevance first, then the nearest event. Equal relevance and equal time fall back to the event
 * key so the list is stable across runs instead of depending on provider row order.
 */
export function compareBriefingNextRelevance(left: BriefingNextItem, right: BriefingNextItem): number {
  const score = (right.relevance?.score ?? 0) - (left.relevance?.score ?? 0)
  if (score !== 0) return score
  return left.at.localeCompare(right.at) || left.eventKey.localeCompare(right.eventKey)
}

/** 注册指标按标识取英文名；自由文本事件只能用源站原文。中文原文不算英文名。 */
function hasEnglishName(event: Pick<DailyBriefingCalendarEvent, 'title' | 'titleKey'>): boolean {
  const registered = event.titleKey ? indicatorNameOf(event.titleKey) : undefined
  const name = registered?.en ?? event.title
  return !/[\u3400-\u9fff]/.test(name)
}

/**
 * 整周有事件、却一条已分级的都没有时的真实排期（R44 §6.2）。
 *
 * 判据与空态理由同一份：窗口里**有事件**（未取消）、且**一条已分级的都没有**。
 * 只要有一场定了档，这一栏就不是「我们还没判」，排期也不该顶替那句「没有高影响事件」。
 * 未分级＝`importance` 缺省（R44：列可空三值，不引入第四档）。
 */
function tier1UpcomingForUnratedWeek(packet: DailyBriefingFactPacket): readonly ReturnType<typeof selectTier1UpcomingReleases>[number][] {
  if (packet.calendar.state !== 'available') return Object.freeze([] as const)
  const window = { end: packet.windowEnd, timeZone: packet.timeZone }
  const upcoming = packet.calendar.events
    .filter((event) => event.lifecycleState !== 'cancelled' && briefingEventInNextWindow(event, window))
  if (upcoming.length === 0 || !upcoming.every((event) => event.importance === undefined)) return Object.freeze([] as const)
  return selectTier1UpcomingReleases(upcoming, packet.windowEnd)
}

function selectNextCandidates(packet: DailyBriefingFactPacket): readonly BriefingNextItem[] {
  if (packet.calendar.state !== 'available') return Object.freeze([] as const)
  const candidates = packet.calendar.events
    // 只认**档**（R44 S3）：`importance` 读的就是日历侧判出来的 `importance_grade`，高才进候选。
    // 以前这里还按身份放行 FOMC/CPI/非农（源没给重要性的那批），那是第二套「谁该出现」，
    // 会和档打架——未分级的事件被抬进来，读者看到的是一场我们还没判过的事件排在「高影响」里。
    // 未分级（`undefined`）不兜底成低、也不冒充高：它不进这一栏，由空态那句说「我们还没分级」。
    .filter((event) => event.lifecycleState === 'scheduled' && event.importance === 'high')
    // 英文版次只列**有英文名**的事件（`02` `A0.9`）：源里只有中文名的（如央行讲话那条源）不列，
    // 不许把中文名塞进英文版。少列几条是允许的，不报缺口——那是源的能力限制，不是这次读失败。
    .filter((event) => packet.locale !== 'en-US' || hasEnglishName(event))
    // 时刻没公布的事件只有日期：按**日期**分栏，不拿日期位当瞬时（它的零点可能早于截止时刻）。
    // 今天还没发生的那一场归这里；同日已发生/已取消的归「过去 24 小时」，两栏不重叠。
    // 窗口只定义一次（`briefingEventInNextWindow`）：空态那一栏要用同一套边界。
    .filter((event) => briefingEventInNextWindow(event, { end: packet.windowEnd, timeZone: packet.timeZone }))
    .flatMap((event): readonly BriefingNextItem[] => {
      // 没有角色的事件不占席位：候选是给编辑模型读的，放进去等于让它替一个猜测排序。
      const relevance = scoreBriefingNextRelevance(event)
      if (relevance === undefined) return []
      return [Object.freeze({
        eventKey: event.eventKey,
        title: event.title,
        ...(event.titleKey ? { titleKey: event.titleKey } : {}),
        at: event.scheduledAt,
        ...(event.releaseTimeNotPublished && event.releaseDate
          ? { releaseTimeNotPublished: true as const, releaseDate: event.releaseDate }
          : {}),
        importance: event.importance,
        category: event.category,
        ...(event.countryCode ? { countryCode: event.countryCode } : {}),
        ...(event.countryName ? { countryName: event.countryName } : {}),
        ...(event.consensus ? { consensus: event.consensus } : {}),
        ...(event.previous ? { previous: event.previous } : {}),
        relevance
      })]
    })
    .sort(compareBriefingNextRelevance)
  return Object.freeze(candidates)
}

/**
 * The deterministic focus is the most crypto-relevant event, never the nearest. The editor may
 * still choose a lower-ranked event in the selection round, but only with a stated BTC/ETH
 * transmission; otherwise this relevance order stands.
 */
function selectNext(packet: DailyBriefingFactPacket, candidates: readonly BriefingNextItem[]): Readonly<{ items: readonly BriefingNextItem[]; focus?: BriefingNextItem }> {
  const ordered = [...candidates].sort(compareBriefingNextRelevance)
  const focus = ordered[0]
  // `maximumNextItems` caps the events after the focus, so the rendered list is focus + 3 = 4.
  const items = ordered.filter((item) => item.eventKey !== focus?.eventKey).slice(0, dailyBriefingPolicy.maximumNextItems)
  return Object.freeze({ items: Object.freeze(items), ...(focus ? { focus } : {}) })
}

function buildConclusion(packet: DailyBriefingFactPacket): Readonly<{
  conclusion: BriefingConclusion | null
  citations: readonly Readonly<{ index: number; refId: string; sourceLabel?: string; observedAt?: string; itemId?: string; statement?: string }>[]
}> {
  const input = packet.conclusion
  if (!input) return Object.freeze({ conclusion: null, citations: Object.freeze([]) })
  // 分析摘要是一种语言写死的，这一期可以是另一种（`02` `A0.9` v2.148）。逐字复制进英文版次的
  // 中文段落，读者会认定「英文版是假的」——所以复制时就按这一期的语言过一遍：不同语言的那一段
  // 不进来（编辑模型之后用自己写的同语言版本替代，见 `applyDailyBriefingEditorial`）。
  const inLocale = (text: string): boolean => !proseLanguageBreach(text, packet.locale)
  const summary = input.summary
  const structured = summary.conclusion
  const direction = structured?.direction ?? input.direction ?? 'undecided'
  const directions = (structured ? summary.directions ?? [] : []).map((entry) => Object.freeze({
    horizon: entry.horizon,
    direction: entry.direction,
    confidence: entry.confidence
  }))
  const top = selectTopSignal(structured ? summary.directions ?? [] : [])
  const citations = new CitationCollector(input.evidenceRefs ?? [])
  const topSignal: BriefingTopSignal | null = top && inLocale(top.rationale)
    ? Object.freeze({
      horizon: top.horizon,
      direction: top.direction,
      confidence: top.confidence,
      rationale: top.rationale,
      citations: Object.freeze(citations.cite(top.evidenceRefIds, top.rationale))
    })
    : null
  const counterEvidence: readonly BriefingCounterEvidence[] = Object.freeze(summary.counterEvidence
    .filter((claim) => inLocale(claim.statement))
    .slice(0, dailyBriefingPolicy.maximumCounterEvidence)
    .map((claim) => Object.freeze({
      statement: claim.statement,
      citations: Object.freeze(citations.cite([claim.evidenceRefId], claim.statement))
    })))
  const summaryText = structured?.summary ?? summary.eventAssessment ?? ''
  const conclusion: BriefingConclusion = Object.freeze({
    summaryId: summary.id,
    publishedAt: summary.createdAt,
    direction,
    directions: Object.freeze(directions),
    summary: inLocale(summaryText) ? summaryText : '',
    ...(structured?.change && inLocale(structured.change) ? { change: structured.change } : {}),
    conditions: Object.freeze((structured?.conditions ?? [])
      .filter((entry) => inLocale(entry))
      .slice(0, dailyBriefingPolicy.maximumConditions)),
    invalidations: Object.freeze(input.predictions.filter((prediction) => inLocale(prediction.invalidation)).slice(0, 4).map((prediction) => Object.freeze({
      asset: prediction.asset,
      horizonEnd: prediction.horizonEnd,
      text: prediction.invalidation
    }))),
    counterEvidence,
    topSignal,
    ...(structured?.evidenceStrength && inLocale(structured.evidenceStrength) ? { evidenceStrength: structured.evidenceStrength } : {}),
    dataGaps: Object.freeze((structured?.dataGaps ?? []).filter((entry) => inLocale(entry)).slice(0, dailyBriefingPolicy.maximumGaps)),
    caveats: Object.freeze(summary.dataCaveats.filter((entry) => inLocale(entry)).slice(0, dailyBriefingPolicy.maximumCaveats)),
    // The fact-layer conclusion is the fallback, never a synthesis: a failed or disabled editorial
    // turn must be readable as "this is the last analysis conclusion", not as an aggregation of the
    // window's AI views. The editorial pass upgrades this marker only when it actually synthesizes.
    synthesis: 'fallback'
  })
  return Object.freeze({ conclusion, citations: Object.freeze(citations.list()) })
}

function selectTopSignal(directions: readonly DirectionAdvice[]): DirectionAdvice | undefined {
  const rank: Readonly<Record<string, number>> = { high: 3, medium: 2, low: 1 }
  const order: Readonly<Record<string, number>> = { short: 0, medium: 1, long: 2 }
  const candidates = directions.filter((entry) => (rank[entry.confidence] ?? 0) >= 2)
  return candidates.sort((left, right) =>
    (rank[right.confidence] ?? 0) - (rank[left.confidence] ?? 0) ||
    (order[left.horizon] ?? 9) - (order[right.horizon] ?? 9))[0]
}

class CitationCollector {
  private readonly indexes = new Map<string, number>()
  private readonly evidence: ReadonlyMap<string, Readonly<{ sourceLabel?: string; observedAt?: string; itemId?: string }>>
  private readonly statements = new Map<string, string>()
  /** 已经挂出去的句子：一句话只留在第一条引用上，别在证据清单里数三遍。 */
  private readonly claimed = new Set<string>()

  constructor(evidenceRefs: readonly Readonly<{ evidenceRefId: string; sourceLabel: string; itemId: string | null; occurredAt: string | null; publishedAt: string | null; visibleAt: string }>[]) {
    this.evidence = new Map(evidenceRefs.map((ref) => [ref.evidenceRefId, {
      sourceLabel: ref.sourceLabel,
      observedAt: ref.publishedAt ?? ref.occurredAt ?? ref.visibleAt,
      ...(ref.itemId ? { itemId: ref.itemId } : {})
    }]))
  }

  cite(refs: readonly string[], statement?: string): readonly number[] {
    const numbers: number[] = []
    // 一条理由引用三条证据时，读者在「证据」里会看到同一句重复三遍——那不是三条证据，
    // 是一句话被数了三遍（用户 2026-11-24）。句子留在第一条引用上，其余条目只给来源。
    let assigned = statement === undefined || this.claimed.has(statement)
    for (const ref of refs) {
      if (!ref) continue
      if (statement !== undefined && !assigned && !this.statements.has(ref)) {
        this.statements.set(ref, statement)
        this.claimed.add(statement)
        assigned = true
      }
      let index = this.indexes.get(ref)
      if (index === undefined) {
        index = this.indexes.size + 1
        this.indexes.set(ref, index)
      }
      if (!numbers.includes(index)) numbers.push(index)
    }
    return Object.freeze(numbers)
  }

  list(): readonly Readonly<{ index: number; refId: string; sourceLabel?: string; observedAt?: string; itemId?: string; statement?: string }>[] {
    return Object.freeze([...this.indexes.entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([refId, index]) => {
        const evidence = this.evidence.get(refId)
        return Object.freeze({
          index,
          refId,
          ...(evidence?.sourceLabel ? { sourceLabel: evidence.sourceLabel } : {}),
          ...(evidence?.observedAt ? { observedAt: evidence.observedAt } : {}),
          ...(evidence?.itemId ? { itemId: evidence.itemId } : {}),
          ...(this.statements.has(refId) ? { statement: this.statements.get(refId)! } : {})
        })
      }))
  }
}

function newsSummary(packet: DailyBriefingFactPacket): BriefingNewsSummary {
  const counts = { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }
  for (const item of packet.news.items) counts[item.polarity] += 1
  return Object.freeze({
    state: packet.news.state,
    counts: Object.freeze(counts),
    itemCount: packet.news.items.length
  })
}

function buildStatus(
  packet: DailyBriefingFactPacket,
  readings: ReturnType<typeof buildBriefingReadingRows>
): DailyBriefingDocument['status'] {
  const fearGreed = readings.fearGreed?.state ?? 'unavailable'
  const funding = combine((readings.funds ?? []).filter((row) => row.id === 'funding-btc' || row.id === 'funding-eth').map((row) => row.state))
  const capital = combine((readings.funds ?? []).filter((row) => row.id !== 'funding-btc' && row.id !== 'funding-eth').map((row) => row.state))
  const calendar = packet.enabled.calendar ? packet.calendar.state : 'source-disabled'
  const list: ReadonlyArray<{ id: DailyBriefingReadingId; state: DailyBriefingReadingState }> = [
    { id: 'fear-greed', state: fearGreed },
    { id: 'funding', state: funding },
    { id: 'capital', state: capital },
    { id: 'calendar', state: calendar }
  ]
  return Object.freeze({
    readings: Object.freeze(list.map((entry) => Object.freeze(entry))),
    readingsAvailable: list.filter((entry) => entry.state === 'available').length,
    readingsTotal: 4
  })
}

function combine(states: readonly DailyBriefingReadingState[]): DailyBriefingReadingState {
  return combineDailyBriefingReadingStates(states)
}

/**
 * The same union rule `buildStatus` uses, exported so a later deterministic amendment of the data
 * rows (the core-fact ensure) cannot invent a second, disagreeing reading summary.
 */
export function combineDailyBriefingReadingStates(
  states: readonly DailyBriefingReadingState[]
): DailyBriefingReadingState {
  if (states.length === 0) return 'unavailable'
  if (states.every((state) => state === 'source-disabled')) return 'source-disabled'
  if (states.some((state) => state === 'available')) return 'available'
  if (states.some((state) => state === 'stale')) return 'stale'
  return 'unavailable'
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}]+/gu, '')
}