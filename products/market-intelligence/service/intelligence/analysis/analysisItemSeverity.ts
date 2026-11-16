import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'
import type { NewsPolarity, NewsSentimentRecord, NewsSentimentSymbol } from '../schema/newsSentiment'

/**
 * 一条情报值不值得花一次分析：判据是它自己的**情绪判定**，不是「够不够格进情报」。
 *
 * 事故（2026-11-16）：一条 CoinDesk 的跨境支付新闻被判「高重要性、已开始分析」，而它自己的
 * 情绪判定写着 `neutral` / `strength 1` / 没有标的 / 「对 BTC、ETH 没有直接影响」。旧尺子把
 * `relevanceOutcome === 'full-intelligence' && sentimentEligible` 直接当成 high——那只是「这条
 * 够格让情绪模型判一判」，于是每一篇 CoinDesk 新闻都够格触发一次分析。
 *
 * 判定分三层，顺序即优先级：
 * 1. 来源自己标注的严重度（`severityHint`）：来源说 critical / warning 就听来源的；
 * 2. 不进情报（context-only 等）→ low，没变化；
 * 3. 新闻看情绪判定：没有标的 → low；中性、或强度到不了门槛 → medium；其余 → high。
 *    数据类条目（指标、日历）从来没有情绪判定，准入仍是唯一判据。
 *
 * `medium` 在这条链路里等于「不单独触发」：单条情报只带来一个域，而策略要求至少两个已确认
 * 域才走中等门槛，所以它只留在看板上，不花一次模型调用。这不是把重要性藏起来——ledger 行上
 * 写着判据，读者在最近一次判定里能看到。
 */
export type ItemTriggerSeverity = 'low' | 'medium' | 'high' | 'critical'

/** 判定新闻是否够格时读的那三个字段；不要求整条记录，规则兜底与模型给出的一样形状。 */
export type NewsSentimentVerdict = Readonly<{
  polarity: NewsPolarity
  strength: number
  symbols: readonly NewsSentimentSymbol[]
}>

export const analysisItemSeverityPolicy = Object.freeze({
  /**
   * 方向明确的新闻至少要这个强度，才配单独触发一次分析。1 是「有一丝方向」，不足以据此
   * 讲一条市场判断；2 起才有可写的方向。
   */
  minimumTriggerStrength: 2
})

const NEWS_SEVERITY_SOURCES: ReadonlySet<string> = new Set<string>(NEWS_SENTIMENT_SOURCE_IDS)

/** 新闻类来源：这类条目的重要性必须由情绪判定给出，而不是由准入结果。 */
export function isNewsSeveritySource(sourceId: string): boolean {
  return NEWS_SEVERITY_SOURCES.has(sourceId)
}

/** 够不够格单独触发一次分析。与下面的严重度同源，避免两套尺子。 */
export function isTriggerableNewsVerdict(verdict: NewsSentimentVerdict): boolean {
  return newsVerdictSeverity(verdict) === 'high'
}

/**
 * 新闻的情绪判定 → 严重度。
 *
 * 没有标的是第一条：没有标的就没有可判断的市场，「对 BTC、ETH 没有直接影响」这类结论必须先落到
 * 这条上，而不是靠模型自己写的理由码——理由码是模型给的一句话，不是我们的判据。
 */
function newsVerdictSeverity(verdict: NewsSentimentVerdict): ItemTriggerSeverity {
  if (verdict.symbols.length === 0) return 'low'
  if (verdict.polarity === 'neutral') return 'medium'
  if (!(verdict.strength >= analysisItemSeverityPolicy.minimumTriggerStrength)) return 'medium'
  return 'high'
}

export type ItemSeverityInput = Readonly<{
  severityHint?: 'info' | 'warning' | 'critical'
  /** 够不够格进情报（`relevanceOutcome` + `sentimentEligible`）。只是资格，不是重要性。 */
  admitted: boolean
  /** 来源是新闻类。 */
  news: boolean
  /** 新闻在判定时刻之前最后一次情绪判定；缺省表示这条还没判过。 */
  verdict?: NewsSentimentVerdict
}>

export function resolveItemTriggerSeverity(input: ItemSeverityInput): ItemTriggerSeverity {
  if (input.severityHint === 'critical') return 'critical'
  if (input.severityHint === 'warning') return 'medium'
  if (!input.admitted) return 'low'
  if (!input.news) return 'high'
  // 还没判过：重要性未知，不能当「不重要」也不能当「重要」。给 medium，等判定写下来再判。
  if (!input.verdict) return 'medium'
  return newsVerdictSeverity(input.verdict)
}

/** 判定只需要这三个字段；调用点传整条情报即可。 */
export type SeverityItem = Readonly<{
  sourceId: string
  severityHint?: 'info' | 'warning' | 'critical'
  processingLabelsJson?: string
}>

function readLabels(item: SeverityItem): Record<string, unknown> {
  if (!item.processingLabelsJson?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(item.processingLabelsJson)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export type ItemSeverityDecision =
  | Readonly<{ decision: 'decided'; severity: ItemTriggerSeverity }>
  | Readonly<{ decision: 'await-verdict' }>

/**
 * 此刻能不能给这条情报定严重度。
 *
 * `await-verdict` 只出现在一种情况：够格进情报的新闻还没有情绪判定——而判定是采集之后另一个
 * 作业才写的（事故样本：分组 09:07:42、判定 09:07:50）。这时无论判 high 还是 low 都是猜：判 high
 * 就是拿「够格进情报」冒充「重要」；判 low 会把「还没判」记成「不重要」，还会让 30 分钟冷却把
 * 真判定挡在门外。所以调用点什么都不做——不建组、不写账本行，等判定落地后由评分那一步再触发。
 */
export function decideItemTriggerSeverity(item: SeverityItem, verdict?: NewsSentimentVerdict): ItemSeverityDecision {
  const labels = readLabels(item)
  const admitted = labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true
  const news = isNewsSeveritySource(item.sourceId)
  const hinted = item.severityHint === 'critical' || item.severityHint === 'warning'
  if (news && admitted && !hinted && !verdict) return { decision: 'await-verdict' }
  return {
    decision: 'decided',
    severity: resolveItemTriggerSeverity({
      ...(item.severityHint ? { severityHint: item.severityHint } : {}),
      admitted, news, ...(verdict ? { verdict } : {})
    })
  }
}

/**
 * 单条情绪判定（判定时刻之前最后一次）。读不到就当「还没判」：宁可等下一跳，也不把一次存储故障
 * 写成「这条不重要」——账本行一旦写下，读者看到的就是一个判定。
 */
export function readLatestNewsSentiment(
  reader: ((itemId: string, asOf: string) => NewsSentimentRecord | undefined) | undefined,
  itemId: string,
  asOf: string
): NewsSentimentRecord | undefined {
  try {
    return reader?.(itemId, asOf)
  } catch {
    return undefined
  }
}
