import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'
import { isDefillamaStablecoinRetiredPath } from './sourceCatalog'

/**
 * 一轮归一化取哪些待办记录（2026-11-21 事故后定，实测数据见下）。
 *
 * 事故现场：1003 条原始记录全停在 `received`，采集日志全绿。三条规则各自解决一个实测问题：
 *
 * 1. **最新的先处理。** 以前按追加顺序取前 100 条，队头那批（11-19T20:14:59 那一分钟进来的）
 *    永远排在最前面；里面夹着一条每半小时失败一次的记录，整批就跟着停在原地。按 `detectedAt`
 *    倒序之后，最旧的一批不会再把窗口占住。
 * 2. **每源每轮最多 20 条。** 光有倒序还不够：队列里 930 条待办中 730 条是行情类（币安 5 分钟
 *    bar 424、恐惧贪婪 217、DefiLlama 68、FRED 21），它们是每 5 分钟追加一条的。按实测倒序取
 *    100 条，第一轮只有 3 条新闻、97 条行情——新闻要三十多个小时才追平。加上限后一个高频源
 *    吃不掉整轮，四个抓正文的新闻源总能在这轮里拿到名额。
 * 3. **新闻每轮总数最多 20 条。** 每条新闻都要先抓正文（一次外网请求）再进翻译（一次模型调用），
 *    平时一天才 26～32 条；20 条/轮既能在两轮内追平两天的缺口，又不会把上游和模型打满。
 *
 * 只对一个源跑（采集结束后按源入队）时不套「每源 20」——那一轮本来就只有一个源，套上去只会
 * 把它的积压拖慢四倍；新闻总数上限仍然生效，因为它的目的是限制每轮的外网请求与模型调用。
 */
export const normalizationBatchPolicy = Object.freeze({
  /** 一轮最多处理多少条（与原来的默认值一致）。 */
  roundSize: 100,
  /** 一个源一轮最多占多少条，防止高频源吃掉整个窗口。 */
  perSourcePerRound: 20,
  /** 一轮最多放多少条新闻进抓正文/翻译（就是 `NEWS_SENTIMENT_SOURCE_IDS` 那几个源）。 */
  newsPerRound: 20,
  /**
   * 从待办里先捞多少条候选再筛。要留出余量：按倒序取候选时高频源占绝大多数，
   * 400 条里才凑得齐 6 个新闻源各 20 条。
   */
  candidatePool: 400,
  /**
   * 候选池被截断时，给**最旧的一批**留固定名额（2026-11-22，0.4.5 #44）。
   *
   * 只取最新 400 条的话，超出池子的那批永远排在候选之外：积压 500 条时最旧 100 条没有任何
   * 一轮能看到它们，列表里就一直缺这一段——而且缺得没有报错。10 条/轮让最旧的 100 条在
   * 10 轮内必然被处理，同时不改变「最新优先」的主体顺序。
   *
   * **池子装得下全部待办时不启用**：那时每条都在候选里，不存在轮不到；插队反而让最新新闻变慢。
   */
  oldestGuaranteedPerRound: 10
})

export type NormalizationBatchSource = Readonly<{
  /** `limit` 省略表示「全部待办」，用于诊断；取一批时必须显式给池子大小。 */
  listUnprocessed: (limit?: number) => RawIntelligenceRecord[]
}>

export function selectNormalizationBatch(
  source: NormalizationBatchSource,
  input: Readonly<{ sourceId?: string; limit?: number }>
): RawIntelligenceRecord[] {
  const limit = input.limit ?? normalizationBatchPolicy.roundSize
  const candidates = source
    .listUnprocessed()
    .filter(record => !isDefillamaStablecoinRetiredPath(record.sourceId))
  const ordered = [...candidates].sort(
    (left, right) => right.detectedAt.localeCompare(left.detectedAt) || left.rawRecordId.localeCompare(right.rawRecordId)
  )

  // 池子装得下全部待办时，每条都在候选里，不需要保底；只有被截断才存在「永远轮不到」。
  const truncated = ordered.length > normalizationBatchPolicy.candidatePool
  const pool = truncated ? ordered.slice(0, normalizationBatchPolicy.candidatePool) : ordered
  // `ordered` 是「最新在前」，尾部就是最旧的那批；倒过来，最旧的先占名额。
  // `slice(-0)` 会取回整段，所以 0 必须单独挡掉——「没有保底」是空数组，不是全部。
  const guaranteed = truncated && normalizationBatchPolicy.oldestGuaranteedPerRound > 0
    ? ordered.slice(-normalizationBatchPolicy.oldestGuaranteedPerRound).reverse()
    : []

  const newsSources: readonly string[] = NEWS_SENTIMENT_SOURCE_IDS
  const selected: RawIntelligenceRecord[] = []
  const chosen = new Set<string>()
  const perSource = new Map<string, number>()
  let newsCount = 0

  const take = (record: RawIntelligenceRecord): void => {
    if (selected.length >= limit || chosen.has(record.rawRecordId)) return
    if (input.sourceId !== undefined && record.sourceId !== input.sourceId) return
    if (input.sourceId === undefined) {
      const taken = perSource.get(record.sourceId) ?? 0
      if (taken >= normalizationBatchPolicy.perSourcePerRound) return
      perSource.set(record.sourceId, taken + 1)
    }
    const isNews = newsSources.includes(record.sourceId)
    if (isNews && newsCount >= normalizationBatchPolicy.newsPerRound) return
    selected.push(record)
    chosen.add(record.rawRecordId)
    if (isNews) newsCount += 1
  }

  for (const record of guaranteed) take(record)
  for (const record of pool) take(record)
  return selected
}