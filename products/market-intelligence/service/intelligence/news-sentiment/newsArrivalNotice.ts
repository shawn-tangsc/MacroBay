import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS,
  OPEN_SENTIMENT_ACTION_KEY
} from '../../../contracts/notificationEventKeys'
import { renderNewsArrival, type NewsArrivalPolarity } from '../../../contracts/newsArrivalSentences'
import { isRoutineNewsNotice } from './newsSentimentRules'

/**
 * 新抓到一条舆情 → 桌面通知（R40，用户 2026-11-18）。
 *
 * 口径全部由产品给定，这里只落可判的那几条：
 * 1. **只看强度、不看方向**：`strength >= 3` 就发（中性但强度高也发——「重要但没方向」读者该知道）；
 * 2. **低重要性不发**：`strength <= 2`，或这条被判为例行公告（沿用 `isRoutineNewsNotice`，不另造一套）；
 * 3. **没有判定不发、判定后补也不补发**：所以调用点只在「判定刚写下来」那一步，且要求这条
 *    以前一条判定都没有（见 `newsSentimentScoringService` 的到达判据）；
 * 4. **只桌面**：批准表只批 `desktop`，不穿免打扰（免打扰时段平台一档都不试）；
 * 5. **每条一弹、不合并**：去重键只带 `itemId`，同一件事重复提交由平台合并，不会弹第二次。
 */
export const newsArrivalNoticePolicy = Object.freeze({
  /**
   * 「不低重要性」的门槛：**`strength >= 3`**（2026-11-18 用户口径：≤2 就是低）。
   *
   * 与手机那条同门槛：手机默认门槛「中」按 `tierOf` 也是 `strength >= 3`（≤2 弱 / 3 中 / ≥4 强），
   * 所以桌面与手机是同一批条目——不是两套尺子。两处数值各自有主（这里是桌面，门槛在
   * `newsSentimentTiers`），**改一处必须同时看另一处**。
   */
  minimumStrength: 3,
  /**
   * 「新到达」必须是「新发布」：**发布时间距今超过 6 小时不弹**（用户 2026-11-22 定）。
   *
   * 事故：归一化队列被行情数据饿死约 45 小时，恢复后一次性补建了 11-20 的条目；判定判据只看
   * 「本轮是不是第一次建出条目」，于是 11-20 的公告在 11-22 凌晨被当成新消息集中弹出。
   * 补建、补判都不是新消息——读者要的是「刚发生的事」。正常实时链路发布到判定只有几分钟，
   * 6 小时足够覆盖慢源，又不会把两天前的旧闻重新叫醒。
   */
  maximumAgeMs: 6 * 60 * 60 * 1000
})

/**
 * 这条是不是「刚发布的」——`publishedAt` 距今不超过 `maximumAgeMs`。
 *
 * 时钟偏差（发布时间略晚于现在）按新鲜处理：截断读者不该看见的提醒，比多弹一条更糟。
 */
export function isNewsArrivalFresh(input: Readonly<{ publishedAt: string; now: string }>): boolean {
  const publishedAt = Date.parse(input.publishedAt)
  const now = Date.parse(input.now)
  // 读不出的时刻不猜：宁可少一条提醒，也不把两年前的旧闻当刚发生的。
  if (!Number.isFinite(publishedAt) || !Number.isFinite(now)) return false
  return now - publishedAt <= newsArrivalNoticePolicy.maximumAgeMs
}

/** 该不该发：只判强度与例行公告，**不判方向**。 */
export function isNewsArrivalWorthNotifying(input: Readonly<{
  title: string
  polarity: string
  strength: number
}>): boolean {
  if (!(input.strength >= newsArrivalNoticePolicy.minimumStrength)) return false
  return !isRoutineNewsNotice({ title: input.title, polarity: input.polarity, strength: input.strength })
}

export type NewsArrivalNoticeInput = Readonly<{
  itemId: string
  /** 条目标题：数据，不改写。 */
  headline: string
  /** 来源显示名：缺它就不提交（说不清「哪来的」的通知不该发）。 */
  sourceName?: string
  polarity: NewsArrivalPolarity
  publishedAt: string
  /** 读者时区（设置里那个），决定正文里那个时刻怎么写。 */
  timeZone: string
  /** 判定「新鲜」用的现在时刻；省略就取真实当前时间。测试靠它固定时钟。 */
  now?: string
}>

/**
 * 「打开舆情」——**这一版只到舆情页、不定位到某一条**。
 *
 * 壳层的通知跳转今天只认产品页与设置分区，产品实体（新闻条目）定位能力还没落；所以标签写
 * 「打开舆情」。等那笔落地、标签改成「查看这条」的那一天，这里与文案键一起改。
 */
const OPEN_SENTIMENT_ACTION = Object.freeze({
  id: 'open-sentiment',
  kind: 'open' as const,
  labelRef: Object.freeze({
    scope: 'product' as const,
    productId: 'market-intelligence',
    key: OPEN_SENTIMENT_ACTION_KEY
  }),
  deeplink: Object.freeze({
    scope: 'product' as const,
    productId: 'market-intelligence',
    // 产品只有一个一级页（情报），壳层按 productId 把它解析成那条 routePath。
    pageId: 'intelligence'
  })
})

/** 除 `eventTypeId` 以外的提交内容：那个 id 必须在**提交那一刻的实参**里（生产者门禁认它）。 */
export type NewsArrivalBody = Omit<NotificationSubmitRequest, 'eventTypeId'>

export function buildNewsArrivalRequest(input: NewsArrivalNoticeInput): NewsArrivalBody | undefined {
  const sourceName = input.sourceName?.trim()
  if (!sourceName) return undefined
  const zh = renderNewsArrival({
    locale: 'zh-CN', headline: input.headline, sourceName,
    polarity: input.polarity, publishedAt: input.publishedAt, timeZone: input.timeZone
  })
  const en = renderNewsArrival({
    locale: 'en-US', headline: input.headline, sourceName,
    polarity: input.polarity, publishedAt: input.publishedAt, timeZone: input.timeZone
  })
  if (!zh || !en) return undefined
  return {
    // 一条新闻一条：键里只有 itemId，同一条重复提交由平台合并（不弹第二次）。
    dedupeVars: { builder: 'template', vars: { itemId: input.itemId } },
    rendered: { 'zh-CN': zh, 'en-US': en },
    actions: [OPEN_SENTIMENT_ACTION],
    occurredAt: input.publishedAt
  }
}

/**
 * 真发出去的那一步。异常一律吞掉：判定已经落库了，通知发不出去不该让这一轮评分算失败。
 * 代价写清楚——这条不会重发（下一次判定不是「首次入库」，本来也不该发）。
 */
export async function notifyNewsArrival(
  submit: ((request: NotificationSubmitRequest) => Promise<unknown>) | undefined,
  input: NewsArrivalNoticeInput
): Promise<void> {
  if (!submit) return
  if (!isNewsArrivalFresh({ publishedAt: input.publishedAt, now: input.now ?? new Date().toISOString() })) return
  const request = buildNewsArrivalRequest(input)
  if (!request) return
  try {
    // `eventTypeId` 写在这里的实参上：通知生产者门禁扫的是「提交那一刻」，藏在构建函数的载荷里
    // 会被记成「无法判定」，等于给「已经接好了」发一张假证书。
    await submit({ eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.newsItemArrived, ...request })
  } catch {
    /* 事实（判定已入库）优先于加法（提醒读者）。 */
  }
}
