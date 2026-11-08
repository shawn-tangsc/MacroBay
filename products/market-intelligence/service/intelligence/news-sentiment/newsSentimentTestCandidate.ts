import { instantForWallClock, wallClockAt } from '@platform/time/timeZoneClock'

import {
  meetsTierThreshold,
  tierOf,
  type NewsSentimentTier,
  type NewsSentimentTierThreshold
} from '../../../contracts/newsSentimentTiers'
import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { NEWS_SENTIMENT_SOURCE_IDS, type NewsPolarity, type NewsSentimentRecord } from '../schema/newsSentiment'
import type { NewsSentimentStore } from './newsSentimentStore'

/**
 * 「通知设置 → 舆情」那枚测试按钮要的**一条真实样例**（需求 r201 v4 §3.1、技术方案 §3）。
 *
 * 这个文件只回答「现在能不能拿一条真数据」，不组装通知、不提交、不写任何库：它读的四样东西
 * 全部是只读投影（判断表、情报条目、推送门槛、源启用状态），**不触发采集、不写账本、不改配置**。
 *
 * 口径逐条写在这里，因为每一条都是一个会被复审拿出来问的决定：
 *
 * 1. **范围「最近 7 天」**：读取者显示时区里的「今天」连同往前 6 个**日历日**，起点是那天的
 *    00:00（见 `sentimentTestWindow`）。按日历日而不是「now − 168 小时」，是因为读者说的
 *    「最近 7 天」是几天，不是几个 24 小时；终点是 `now`，不把今天没发生的时刻算进来。
 * 2. **日界按读者显示时区**：时区只有一个来源（壳层的 `shellTimeZone`），由调用方注入。
 *    **取不到或读不成 IANA 时区就返回 `timezone-unreadable`，绝不退回 UTC**——那会把日界悄悄
 *    挪一天，而界面还会说这是读者的本地日期。
 * 3. **强度门档来自当前配置**：与推送判定读的是同一份存储（`NewsPushThresholdStore` 的
 *    `pushThreshold`，落盘 `intelligence-news-push-threshold.json`），本文件不另定默认值；
 *    档位换算只许走 `tierOf`，比较只许走 `meetsTierThreshold`（`contracts/newsSentimentTiers.ts`
 *    是唯一实现，界面与通知都读它）。
 * 4. **取哪一条**：满足条件里 `publishedAt` **最近**的一条；同一时刻多条取 `itemId` **最小**的
 *    那条（稳定序，否则同一个按钮点两次可能发不同条目）。
 * 5. **三种「没有」各说各的**：真的没有符合条件的条目 / 四个源都没启用 / 读失败了，是三个答案，
 *    合并会让读者去检查错的地方——「没启用」被说成「没有数据」，他会去等新新闻；「读不到」被说成
 *    「没有数据」，他会以为今天真的没东西。**源状态先判**：源全关时一条旧样例也不发。
 * 6. **只加门槛，不复制推送闸门**：真实推送还要 `engine='model'`、`storyKey`、24 小时时新、启用
 *    水位与账本（`newsSentimentAlertGate.ts`）。测试按钮验的是「链路能不能把一条真数据送出去」，
 *    照抄那些闸会让「今天没有可推条目」把按钮变成废键（需求 §3.1 只要求强度门槛）。
 */

/** 四源里一个都没启用 → `source-disabled`；均为只读事实，不是失败。 */
export type SentimentTestSourceState = 'available' | 'disabled' | 'unreadable'

/**
 * 样例交出去的字段，与真实推送出口交给提交通道的同一套（`itemId / title / sourceName / url /
 * publishedAt`，见 `newsSentimentAlertOutlet.ts` 的 `NewsSentimentAlertDeliver`），外加判断本身。
 * 没有这里的字段，上层要么再查一次库、要么自己猜一条，前者是第二个读点，后者是造数据。
 */
export type SentimentTestCandidateItem = Readonly<{
  itemId: string
  title: string
  sourceId: string
  sourceName: string
  url?: string
  publishedAt: string
  polarity: NewsPolarity
  /** 模型自评的 1–5 原值（`news_sentiment.strength`），不在这里换算成档位。 */
  strength: number
  /** `tierOf(strength)` 的结果；与门槛比较的就是它，调用方不必再换算一次。 */
  tier: NewsSentimentTier
  confidence: number
  engine: 'model' | 'rules'
}>

export type SentimentTestCandidate =
  | Readonly<{ kind: 'candidate' } & SentimentTestCandidateItem>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'source-disabled' }>
  /** 读库/读条目/读门槛失败；上层显示「暂时读不到」，**不许**改写成「没有数据」。 */
  | Readonly<{ kind: 'unreadable' }>
  | Readonly<{ kind: 'timezone-unreadable' }>

/** 7 个日历日（今天 + 前 6 天）。改这里就是改口径，用例会一起断。 */
export const SENTIMENT_TEST_WINDOW_DAYS = 7

export type SentimentTestWindow = Readonly<{ from: string; to: string }>

/**
 * 读者时区里「最近 7 天」的窗口：本地今天 00:00 往前 `SENTIMENT_TEST_WINDOW_DAYS − 1` 个日历日
 * 的 00:00，到 `now`。
 *
 * 日历加减在 UTC 字段上做（只有日期参与，不涉及时刻），再经 `instantForWallClock` 落回该时区的
 * 本地 00:00——夏令时那天不会变成 23 点或 1 点起算。返回 `undefined` 表示时区/时刻读不出来，
 * 调用方必须当作「读不到时区」，**不许拿 UTC 顶**。
 */
export function sentimentTestWindow(input: Readonly<{ now: string; timeZone: string }>): SentimentTestWindow | undefined {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return undefined
  const wall = wallClockAt(nowMs, input.timeZone)
  if (!wall) return undefined
  const firstWallDay = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - (SENTIMENT_TEST_WINDOW_DAYS - 1)))
  const from = instantForWallClock({
    timeZone: input.timeZone,
    year: firstWallDay.getUTCFullYear(),
    month: firstWallDay.getUTCMonth() + 1,
    day: firstWallDay.getUTCDate(),
    hour: 0
  })
  if (!from) return undefined
  return { from: from.toISOString(), to: new Date(nowMs).toISOString() }
}

/**
 * 纯选择：给已经读到的行与条目挑一条。口径与边界见文件头；这里不读任何东西，方便逐条断言。
 *
 * `readComplete` 是「这次读是否覆盖整个窗口」：`listLatestSentiment` 一次最多回 500 行，满了就
 * 不能证明窗口里没有更早的匹配——此时说「没有」是替读者下了个我们并不知道的结论，所以报
 * `unreadable`（暂时读不到）而不是 `none`。同理，若被截断的位置正好落在选中条目那一秒，同刻的
 * 更小 id 可能没读到，也报 `unreadable`。
 */
export function sentimentTestCandidate(input: Readonly<{
  now: string
  timeZone: string
  threshold: NewsSentimentTierThreshold
  source: SentimentTestSourceState
  rows: readonly NewsSentimentRecord[]
  items: readonly Pick<IntelligenceItem, 'itemId' | 'title' | 'url'>[]
  readComplete: boolean
}>): SentimentTestCandidate {
  // 时区先判：窗口是后面一切的边界，算不出窗口就不该继续读。
  const window = sentimentTestWindow({ now: input.now, timeZone: input.timeZone })
  if (!window) return { kind: 'timezone-unreadable' }
  if (input.source === 'disabled') return { kind: 'source-disabled' }
  if (input.source === 'unreadable') return { kind: 'unreadable' }

  const itemsById = new Map(input.items.map((item) => [item.itemId, item]))
  const matched = input.rows
    .filter((row) =>
      // 恢复一次窗口过滤：调用方可能为了复用一次读把更宽的区间递进来，边界只在这里定义一次。
      row.publishedAt >= window.from &&
      row.publishedAt <= window.to &&
      meetsTierThreshold(tierOf(row.strength), input.threshold) &&
      // 没有原始条目的判断没有标题可发：拿它当样例只能造一个标题。
      itemsById.has(row.itemId)
    )
    .sort((left, right) => left.publishedAt === right.publishedAt
      // 同一时刻取 id 最小，且用确定的字符串序（不依赖 locale）。
      ? (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0)
      : (left.publishedAt > right.publishedAt ? -1 : 1))

  const best = matched[0]
  if (!input.readComplete) {
    if (!best) return { kind: 'unreadable' }
    // 读满一页时，最老的那一行若与选中条目同一时刻，同刻更小的 id 可能还在未读到的部分。
    // 取最小 `publishedAt` 而不是「数组最后一个」：不替调用方假设行序。
    const oldestRead = input.rows.reduce<string | undefined>(
      (oldest, row) => (oldest === undefined || row.publishedAt < oldest ? row.publishedAt : oldest),
      undefined
    )
    if (oldestRead !== undefined && oldestRead === best.publishedAt) return { kind: 'unreadable' }
  }
  if (!best) return { kind: 'none' }

  const item = itemsById.get(best.itemId)!
  const definition = getIntelligenceSourceDefinition(best.sourceId)
  return {
    kind: 'candidate',
    itemId: best.itemId,
    title: item.title,
    sourceId: best.sourceId,
    sourceName: definition?.displayName ?? best.sourceId,
    ...(item.url ? { url: item.url } : {}),
    publishedAt: best.publishedAt,
    polarity: best.polarity,
    strength: best.strength,
    tier: tierOf(best.strength),
    confidence: best.confidence,
    engine: best.engine
  }
}

/** `listLatestSentiment` 一次最多回 500 行（存储自己的硬上限）；满了就算读不全。 */
const READ_LIMIT = 500

export type SentimentTestCandidateDeps = Readonly<{
  store: Pick<NewsSentimentStore, 'listLatestSentiment'>
  pipeline: Pick<IntelligencePipeline, 'listItems'>
  /**
   * 四个舆情源里哪些是启用状态。与 `buildSourceCoverageAsOf` 的 `enabledSourceIds` 是同一个
   * 字段（`IntelligenceSourceProfile.enabled`），不是第二套「启用 + 凭据」判据。
   */
  readEnabledSourceIds: () => Promise<readonly string[]>
  /** 推送强度门槛；必须是推送判定读的那份存储，不许在这里另存一份默认值。 */
  readThreshold: () => NewsSentimentTierThreshold
  /** 读者显示时区（壳层 `shellTimeZone().get()`）；返回空串/抛错都按「读不到时区」处理。 */
  getTimeZone: () => string
  now: () => string
}>

/**
 * 只读入口：读时区、源启用状态、门槛、判断行与条目，交给上面的纯选择。
 *
 * 任何一步读不出来都回 `unreadable`（或 `timezone-unreadable`），并**不重试、不采集**：这个函数
 * 只回答「此刻能不能发一条真样例」，写库与投递不在这里。
 */
export async function readSentimentTestCandidate(
  deps: SentimentTestCandidateDeps
): Promise<SentimentTestCandidate> {
  const now = deps.now()

  let timeZone = ''
  try {
    timeZone = deps.getTimeZone().trim()
  } catch {
    timeZone = ''
  }
  // 空时区不落给 `sentimentTestWindow` 去猜：它只会返回 undefined，这里先区分得更直白。
  if (timeZone === '') return { kind: 'timezone-unreadable' }
  const window = sentimentTestWindow({ now, timeZone })
  if (!window) return { kind: 'timezone-unreadable' }

  let enabledSourceIds: readonly string[]
  try {
    enabledSourceIds = await deps.readEnabledSourceIds()
  } catch {
    return { kind: 'unreadable' }
  }
  const source: SentimentTestSourceState = NEWS_SENTIMENT_SOURCE_IDS.some((sourceId) =>
    enabledSourceIds.includes(sourceId)
  )
    ? 'available'
    : 'disabled'
  if (source === 'disabled') return { kind: 'source-disabled' }

  let threshold: NewsSentimentTierThreshold
  try {
    threshold = deps.readThreshold()
  } catch {
    return { kind: 'unreadable' }
  }

  let rows: readonly NewsSentimentRecord[]
  let items: ReturnType<IntelligencePipeline['listItems']>
  try {
    // 一次读完窗口（上限 500）。不做分页：这个读法的 `to` 同时是 `scored_at` 的截止时刻，
    // 挪 `to` 会把「旧闻重评」的最新判断挡掉，分页反而读错。
    rows = deps.store.listLatestSentiment({ from: window.from, to: window.to, limit: READ_LIMIT })
    items = deps.pipeline.listItems()
  } catch {
    return { kind: 'unreadable' }
  }

  return sentimentTestCandidate({
    now,
    timeZone,
    threshold,
    source,
    rows,
    items,
    readComplete: rows.length < READ_LIMIT
  })
}
