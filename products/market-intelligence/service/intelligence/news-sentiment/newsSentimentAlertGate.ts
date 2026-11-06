/**
 * 推送判定：**纯函数**，只回答「这一条现在该不该推到手机」。
 *
 * 三个闸各自挡一类不同的东西，缺一条另一条都白做：
 *
 * 1. **时新闸** `publishedAt ≥ now − 24h`：挡「提示词升版 → 全部历史变陈旧 → 重评一轮把旧闻
 *    整批推上手机」。用 `publishedAt`，不是入库时间、不是评分时间——补采会把旧闻的入库时间
 *    变成「刚刚」，旧闻就被当成新闻推出去。
 * 2. **冷启动闸** `publishedAt ≥ 启用时刻`：挡「打开推送那一刻，窗口内的旧条目一次性倒给读者」。
 *    同样只认 `publishedAt`。`scoredAt > baseline` 这种判法会把「开启前发布、开启后才评出来」
 *    的整批放走——那恰恰是最该挡的一类，所以它**不是闸**（`publishedAt ≥ 启用时刻` 已经蕴含它）。
 * 3. **账本闸**：按 `itemId` 记「推过没有」。挡「同一条重评升档又推一次」与「`storyKey` 变了
 *    被当成新事件」。
 *
 * 外加两条常被忘的资格条件：`engine='model'`（关键词命中不算分析）、强度中以上、有归并键。
 */
import { tierOf, type NewsSentimentTier } from '../../../contracts/newsSentimentTiers'

export type NewsSentimentAlertSkipReason =
  | 'rules-engine'
  | 'below-medium'
  | 'no-story-key'
  | 'stale'
  | 'before-enable'
  | 'already-pushed'

export type NewsSentimentAlertDecision =
  | { push: true; tier: Exclude<NewsSentimentTier, 'low'> }
  | { push: false; reason: NewsSentimentAlertSkipReason }

export const NEWS_SENTIMENT_ALERT_STALE_MS = 24 * 60 * 60 * 1000

export function decideAlert(input: {
  engine: 'model' | 'rules'
  strength: number
  storyKey?: string
  /** 新闻发布时间。**不是**入库时间，也**不是**评分时间。 */
  publishedAt: string
  /** 读者打开推送的时刻；账本另记基线，这里只判「这条是不是开启之后发生的」。 */
  enabledAt?: string
  now: string
  alreadyPushed: boolean
}): NewsSentimentAlertDecision {
  if (input.engine !== 'model') return { push: false, reason: 'rules-engine' }
  const tier = tierOf(input.strength)
  if (tier === 'low') return { push: false, reason: 'below-medium' }
  if (!input.storyKey?.trim()) return { push: false, reason: 'no-story-key' }
  // 账本先判：推过的是永久事实，不该因为后来重开开关、跨了 24 小时而被改写成别的原因。
  if (input.alreadyPushed) return { push: false, reason: 'already-pushed' }

  const published = Date.parse(input.publishedAt)
  const now = Date.parse(input.now)
  const enabled = input.enabledAt ? Date.parse(input.enabledAt) : Number.NaN
  // 时刻读不出来就不推：宁可不发，不猜。三个时刻都是机器写的时间戳，读不出来说明数据有问题。
  if (!Number.isFinite(published) || !Number.isFinite(now) || !Number.isFinite(enabled)) {
    return { push: false, reason: 'stale' }
  }
  if (published < enabled) return { push: false, reason: 'before-enable' }
  if (published < now - NEWS_SENTIMENT_ALERT_STALE_MS) return { push: false, reason: 'stale' }
  return { push: true, tier }
}

/**
 * 开出口那一刻要落成「已推」的历史条目。
 *
 * 清库重跑之后账本是空的，而账本闸只挡「推过的」——它挡不住「历史里从没推过的」。冷启动闸
 * 挡掉绝大多数，但正好卡在边界上的那几条仍会被推，而它们根本不是新闻。所以开出口时一次性把
 * 「早于 24 小时发布」的全量记成基线行（`event_type_id='baseline'`、`story_key` 为空），
 * 之后再推的就只有「基线之后、符合三闸」的。
 */
export function selectBaselineCandidates(
  items: ReadonlyArray<{ itemId: string; publishedAt: string }>,
  input: { now: string }
): string[] {
  const now = Date.parse(input.now)
  if (!Number.isFinite(now)) return []
  const cutoff = now - NEWS_SENTIMENT_ALERT_STALE_MS
  return items
    .filter((item) => {
      const published = Date.parse(item.publishedAt)
      return Number.isFinite(published) && published < cutoff
    })
    .map((item) => item.itemId)
}
