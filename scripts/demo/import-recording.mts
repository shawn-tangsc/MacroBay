/**
 * 把一次录制会话整理成一个示例场景（一次性工具，可重复执行）。
 *
 * 输入：`demo/raw/<session>/`（录制产物，不入库）
 * 输出：`demo/scenarios/<id>/`（common + zh-CN；en-US 由人工翻译后补齐）
 *
 * 它做四件事：挑需要的数据面、把请求回显换成占位符、把时间轴裁到「有详情」的节点、
 * 生成 scenario.json / surfaces.json。不做翻译，也不改任何数值。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW = process.argv[2] ?? 'products/market-intelligence/demo/raw/session-2026-10-27T09-41-37-381Z'
const OUT = process.argv[3] ?? 'products/market-intelligence/demo/scenarios/crypto-sample-2026-10'

const read = (name: string): unknown => JSON.parse(readFileSync(join(RAW, name), 'utf8'))
const payloadOf = (name: string): any => (read(name) as any).payload

const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g
const instants: string[] = []
function noteInstants(value: unknown): void {
  for (const match of JSON.stringify(value).match(INSTANT) ?? []) instants.push(match)
}

function rewriteAsOf(value: any, asOf: string): any {
  if (Array.isArray(value)) return value.map((entry) => rewriteAsOf(entry, asOf))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'asOf' || key === 'servedAt') out[key] = '$asOf'
      else out[key] = rewriteAsOf(entry, asOf)
    }
    return out
  }
  return value
}

function writeFixture(locale: string, method: string, fixture: Record<string, unknown>): void {
  const directory = join(OUT, 'responses', locale)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${method}.json`), `${JSON.stringify(fixture, null, 2)}\n`)
}

function readEnvelope(name: string): { payload: any; request: any } {
  const envelope = read(name) as any
  return { payload: envelope.payload, request: envelope.request }
}

// ---- 语言无关的数据面 -------------------------------------------------------

const fixtures: { method: string; envelope: Record<string, unknown> }[] = []
function common(method: string, payload: unknown, extra: Record<string, unknown> = {}): void {
  fixtures.push({ method, envelope: { schemaVersion: 1, method, effect: 'read', payload, ...extra } })
}

let marketEnd = ''
{
  const byRange: Record<string, unknown> = {}
  for (const range of ['1h', '24h', '7d']) {
    const entry = readEnvelope(`intelligence.crossAsset.query__range=${range}.json`)
    byRange[range] = rewriteAsOf(entry.payload, entry.request.asOf)
    noteInstants(byRange[range])
    if (range === '24h') marketEnd = String(entry.payload.analysisEnd)
  }
  common('intelligence.crossAsset.query', undefined, { byRequestKey: 'range', byRequest: byRange })
}

// 租约：契约要求 expiresAt 大于真实此刻，所以只能现算。
common('intelligence.crossAsset.acquire', { state: 'active', leaseId: 'sample-lease', expiresAt: '$wallNowMs+120000' })
common('intelligence.crossAsset.renew', { state: 'active', leaseId: 'sample-lease', expiresAt: '$wallNowMs+120000' })
common('intelligence.crossAsset.release', { state: 'released' })

for (const [name, method] of [
  ['intelligence.macro.marketSnapshot.query__default.json', 'intelligence.macro.marketSnapshot.query'],
  ['intelligence.macro.ratesSnapshot.query__default.json', 'intelligence.macro.ratesSnapshot.query'],
  ['intelligence.queryFearGreedSnapshot__default.json', 'intelligence.queryFearGreedSnapshot'],
  ['intelligence.queryFundingRateHistory__default.json', 'intelligence.queryFundingRateHistory'],
  ['intelligence.queryCapitalConditionsSnapshot__default.json', 'intelligence.queryCapitalConditionsSnapshot']
] as const) {
  const { payload, request } = readEnvelope(name)
  const scoped = rewriteAsOf(payload, request.asOf)
  noteInstants(scoped)
  common(method, scoped)
}

// 来源状态：不暴露「已配置凭据」，也不给相对时间（不给 lastSuccessAtMs）。
{
  const { payload } = readEnvelope('intelligence.macro.dashboardFeedStatus.query__default.json')
  const sources = (payload.sources ?? []).map((source: any) => ({
    sourceId: source.sourceId,
    enabled: true,
    hasCredential: false
  }))
  common('intelligence.macro.dashboardFeedStatus.query', { state: 'available', sources })
}

// 日历：按月分档（上月/本月/下月）。
for (const [name, method] of [
  ['intelligence.macro.economicCalendar.queryMonth__month=2026-10.json', 'intelligence.macro.economicCalendar.queryMonth'],
  ['intelligence.macro.economicCalendar.queryMonth__month=2026-11.json', 'intelligence.macro.economicCalendar.queryMonth'],
  ['intelligence.macro.marketCalendar.queryMonth__month=2026-10.json', 'intelligence.macro.marketCalendar.queryMonth'],
  ['intelligence.macro.marketCalendar.queryMonth__month=2026-11.json', 'intelligence.macro.marketCalendar.queryMonth']
] as const) {
  const { payload, request } = readEnvelope(name)
  const scoped = rewriteAsOf(payload, request.asOf)
  noteInstants(scoped)
  const month = request.month as string
  const existing = fixtures.find((entry) => entry.method === method)
  if (existing) {
    const envelope = existing.envelope as any
    envelope.byRequest[month] = scoped
  } else {
    fixtures.push({ method, envelope: { schemaVersion: 1, method, effect: 'read', byRequestKey: 'month', byRequest: { [month]: scoped } } })
  }
}

// 分析：时间轴裁到「有 summary 与 run」的节点，其余节点点了也没有详情。
const runs = new Set(readdirSync(RAW).filter((file) => file.startsWith('marketAnalysis.getAnalysisRun'))
  .map((file) => file.match(/id=([^.]+)\.json$/)?.[1]).filter((value): value is string => Boolean(value)))
const summaries = new Set(readdirSync(RAW).filter((file) => file.startsWith('marketAnalysis.getSummary'))
  .map((file) => file.match(/id=([^.]+)\.json$/)?.[1]).filter((value): value is string => Boolean(value)))

const timeline = readEnvelope('marketAnalysis.listTimeline__default.json').payload
// 只留一条：节点越多，需要翻译的正文越多，而示例要证明的是「能读到一条完整结论」。
const items = (timeline.items ?? []).filter((item: any) =>
  item.summaryRef && summaries.has(item.summaryRef) && item.analysisRunId && runs.has(item.analysisRunId)).slice(0, 1)
const keptSummaries = new Set<string>(items.map((item: any) => item.summaryRef))
const keptRuns = new Set<string>(items.map((item: any) => item.analysisRunId))
const trimmedTimeline = { ...timeline, items, nextCursor: null }
noteInstants(trimmedTimeline)
fixtures.push({ method: 'marketAnalysis.listTimeline', envelope: { schemaVersion: 1, method: 'marketAnalysis.listTimeline', effect: 'read', payload: trimmedTimeline } })

const summaryById: Record<string, unknown> = {}
const runById: Record<string, unknown> = {}
const predictionsBySummary: Record<string, unknown> = {}
function trim<T>(value: T[] | undefined, limit: number): T[] {
  return Array.isArray(value) ? value.slice(0, limit) : []
}
function trimSummary(payload: any): any {
  return {
    ...payload,
    knownFacts: trim(payload.knownFacts, 8),
    transmissionHypotheses: trim(payload.transmissionHypotheses, 3),
    marketReaction: trim(payload.marketReaction, 2),
    supportingEvidence: trim(payload.supportingEvidence, 3),
    counterEvidence: trim(payload.counterEvidence, 2),
    nextCatalysts: trim(payload.nextCatalysts, 2),
    scenarios: trim(payload.scenarios, 1),
    directions: trim(payload.directions, 3),
    dataCaveats: trim(payload.dataCaveats, 4)
  }
}
for (const id of keptSummaries) {
  const { payload, request } = readEnvelope(`marketAnalysis.getSummary__id=${id}.json`)
  summaryById[id] = trimSummary(rewriteAsOf(payload, request.asOf))
  noteInstants(summaryById[id])
}
for (const id of keptRuns) {
  const { payload, request } = readEnvelope(`marketAnalysis.getAnalysisRun__id=${id}.json`)
  runById[id] = rewriteAsOf(payload, request.asOf)
  noteInstants(runById[id])
}
for (const id of keptSummaries) {
  const file = `marketAnalysis.listPredictions__summaryId=${id}.json`
  try {
    const { payload, request } = readEnvelope(file)
    predictionsBySummary[id] = { predictions: (Array.isArray(payload) ? payload : payload.predictions ?? []).slice(0, 2) }
    noteInstants(predictionsBySummary[id])
  } catch {
    // 没有预测就不是问题。
  }
}

fixtures.push({ method: 'marketAnalysis.getSummary', envelope: { schemaVersion: 1, method: 'marketAnalysis.getSummary', effect: 'read', byRequestKey: 'id', byRequest: summaryById } })
fixtures.push({ method: 'marketAnalysis.getAnalysisRun', envelope: { schemaVersion: 1, method: 'marketAnalysis.getAnalysisRun', effect: 'read', byRequestKey: 'id', byRequest: runById } })
fixtures.push({ method: 'marketAnalysis.listPredictions', envelope: { schemaVersion: 1, method: 'marketAnalysis.listPredictions', effect: 'read', byRequestKey: 'summaryId', byRequest: predictionsBySummary } })

// 分析设置：示例里不显示真实模型名，也不声称已启用。
fixtures.push({
  method: 'marketAnalysis.getSettings',
  envelope: {
    schemaVersion: 1, method: 'marketAnalysis.getSettings', effect: 'read',
    payload: { enabled: false, providerId: '', modelId: '', updatedAt: '2026-10-24T00:00:00.000Z' }
  }
})

const PROSE_METHODS = new Set(['marketAnalysis.listTimeline', 'marketAnalysis.getSummary', 'marketAnalysis.listPredictions'])
for (const entry of fixtures) writeFixture(PROSE_METHODS.has(entry.method) ? 'zh-CN' : 'common', entry.method, entry.envelope)

// ---- 场景元数据 -------------------------------------------------------------

// 场景时钟取市场数据最后一根已收盘 bar：日历里未来的排期不是「观测」，不能拿来当时钟。
const scenarioNow = marketEnd
const from = new Date(Date.parse(scenarioNow) - 7 * 24 * 3_600_000).toISOString()

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'scenario.json'), `${JSON.stringify({
  schemaVersion: 1,
  id: OUT.split('/').at(-1),
  title: { 'zh-CN': '2026 年 10 月的一周', 'en-US': 'One week in October 2026' },
  scenarioNow,
  window: { from, to: scenarioNow },
  recordedAt: new Date().toISOString(),
  sources: ['binance-futures-positioning', 'defillama-stablecoins', '0xrouter', 'fred-rates-liquidity', 'alternative-fear-greed'],
  provenanceNote: 'Real observations recorded from a local profile and replayed offline; the conclusion is a curated subset of a real published analysis.',
  licenseNote: 'Aggregate values from public and licensed sources; see NOTICE.'
}, null, 2)}\n`)

writeFileSync(join(OUT, 'surfaces.json'), `${JSON.stringify(fixtures.map((entry) => entry.method).sort(), null, 2)}\n`)
process.stdout.write(`${fixtures.length} fixtures, scenarioNow=${scenarioNow}\n`)
