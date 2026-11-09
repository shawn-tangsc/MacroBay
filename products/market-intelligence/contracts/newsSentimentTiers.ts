/**
 * 舆情强度的三档：**唯一实现**，界面与通知都读它。
 *
 * 底层 `strength` 是模型自评的 1–5 整数（`news_sentiment.strength`），档位是它的确定性函数。
 * 这个映射原先只写在渲染层，通知要拿它当判据时必然长出第二份——两边一旦分叉，同一条新闻
 * 在卡片上显示「中」、在手机上被算成「低」，而且没有任何地方会报错。所以阈值只许住在这里。
 *
 * 放在 `contracts/` 而不是 `service/`：渲染层可以 import 契约目录（它已经在这么做），
 * 但进不了服务层；放服务层等于让界面继续自己写一份。
 */
export type NewsSentimentTier = 'low' | 'medium' | 'high'

/**
 * ≤2 低 / =3 中 / ≥4 高。调用方不许自己比较数字，也不许改这里的边界而不改用例。
 *
 * 非有限值按 `low` 处理：档位是给人看的分档，不是数据校验；真正的取值域由
 * `news_sentiment.strength` 的 `check (strength between 1 and 5)` 把关。
 */
export function tierOf(strength: number): NewsSentimentTier {
  if (!Number.isFinite(strength) || strength <= 2) return 'low'
  if (strength >= 4) return 'high'
  return 'medium'
}

/** 读者可配的推送门槛：与三档同一套顺序，低 < 中 < 高（词在文案表里，三处逐词相同）。 */
export type NewsSentimentTierThreshold = NewsSentimentTier

const TIER_ORDER: Readonly<Record<NewsSentimentTier, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2
})

/**
 * 「档位 ≥ 门槛」。门槛可配之后，**顺序只在这里定一次**——闸门与界面都调它，
 * 谁想改成「按分数比」或另写一组阈值，都得先删掉这个函数。
 */
export function meetsTierThreshold(tier: NewsSentimentTier, threshold: NewsSentimentTierThreshold): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[threshold]
}

/** 一条判断是否够「值得推」的口径：模型分析、档位达到门槛、有归并键。缺一不推。 */
export function isAlertWorthy(input: {
  engine: 'model' | 'rules'
  strength: number
  storyKey?: string
  threshold?: NewsSentimentTierThreshold
}): boolean {
  const threshold = input.threshold ?? 'medium'
  return (
    input.engine === 'model' &&
    meetsTierThreshold(tierOf(input.strength), threshold) &&
    Boolean(input.storyKey?.trim())
  )
}
