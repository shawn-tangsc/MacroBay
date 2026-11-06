import type { NewsSentimentRecord } from '../schema/newsSentiment'
import { decideAlert, selectBaselineCandidates } from './newsSentimentAlertGate'
import type { NewsPushLedgerStore } from './newsPushLedgerStore'

/**
 * 推送出口：**判定点**。它只做三件事——读水位、过三闸、把「推过的」记进账本。
 *
 * 真正的发送由调用方注入的 `submit` 完成（平台的通知提交按批准表 N10 走），这样这个模块不需要
 * 认识通知运行时，用例也不需要起一个运行时。顺序是「先记账、再提交」：宁可漏发一条，也不要在
 * 提交成功之后崩掉而账本里没有它——那会让同一条在下一轮重评后再推一次。
 */
/**
 * 真正把一条告警交出去的那一步。**不叫 `submit`**：平台的生产者门禁把 `submit(` 当通知提交点扫，
 * 而这里交的是产品自己的出口（平台提交在装配那一层做），命名撞上会让门禁把它记成「解析不了的提交点」。
 */
export type NewsSentimentAlertDeliver = (input: {
  itemId: string
  storyKey: string
  title?: string
  tier: 'medium' | 'high'
}) => Promise<void> | void

export function createNewsSentimentAlertOutlet(deps: {
  ledger: Pick<NewsPushLedgerStore, 'has' | 'markPushed' | 'readWatermark'>
  deliver: NewsSentimentAlertDeliver
  now: () => string
}) {
  return {
    /**
     * 评分落库之后的判定点。返回去向，供日志与用例断言：
     * `skipped` 带原因码，`pushed` 表示真的交给了提交。
     */
    async onJudged(
      record: Pick<
        NewsSentimentRecord,
        'itemId' | 'engine' | 'strength' | 'storyKey' | 'publishedAt'
      > & { title?: string }
    ): Promise<{ outcome: 'pushed'; tier: 'medium' | 'high' } | { outcome: 'skipped'; reason: string }> {
      const watermark = deps.ledger.readWatermark()
      // 开关默认关：没有水位就是「读者还没按过」，一条都不推——这是默认值，不是错误状态。
      if (!watermark) return { outcome: 'skipped', reason: 'outlet-disabled' }
      const decision = decideAlert({
        engine: record.engine,
        strength: record.strength,
        ...(record.storyKey ? { storyKey: record.storyKey } : {}),
        publishedAt: record.publishedAt,
        enabledAt: watermark,
        now: deps.now(),
        alreadyPushed: deps.ledger.has(record.itemId)
      })
      if (!decision.push) return { outcome: 'skipped', reason: decision.reason }
      const storyKey = record.storyKey!
      // 先记账：提交失败时这条不再重推（宁可漏一条，也不重复打扰）。
      deps.ledger.markPushed({
        itemId: record.itemId,
        storyKey,
        eventTypeId: 'market-intelligence.sentiment.alert',
        pushedAt: deps.now()
      })
      await deps.deliver({
        itemId: record.itemId,
        storyKey,
        ...(record.title ? { title: record.title } : {}),
        tier: decision.tier
      })
      return { outcome: 'pushed', tier: decision.tier }
    }
  }
}

/** 开出口时一次算完基线：`publishedAt` 早于「现在 − 24h」的全量。 */
export function baselineForOutlet(
  items: ReadonlyArray<{ itemId: string; publishedAt: string }>,
  input: { now: string }
): string[] {
  return selectBaselineCandidates(items, input)
}
