import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { notificationDedupeBuilders } from '@platform/notifications/contracts/notificationDedupeKeys'

import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'

/**
 * 「ETF 连续三日净流出」这条信号出站为一条通知。
 *
 * 三件事刻意交给平台，不在这里各写一份：
 * - **去重键由平台按参数构造**（`builder: 'moduleSignal'`），调用点只交 `moduleId / ruleId /
 *   asset / observedAt / cadence`。手拼键就会长出第二种拼法，同一桶被当成两件事；
 * - **同一桶重复只更新次数与正文、不重推**，是平台按键判的，这里不做第二套判断；
 * - **事件 id 与档位**来自产品声明（`market-intelligence.signal.triggered`），这里只引用常量。
 *
 * 只在信号真的成立时才提交：`readiness: 'unavailable'` 是「窗口还没凑齐」，不是一件发生的事，
 * 更不是失败——给它发通知等于告诉读者「有信号」，而规则其实还没判。
 */

/** 稳定 handler id：同一条刷新路径换名字会让平台把它当成另一个生产者。 */
export const ETF_SIGNAL_NOTIFICATION_PRODUCER_ID = 'market-intelligence.etf-flow-refresh'

export type SignalNoticeSubmit = (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>

/**
 * 落点暂不挂：外壳今天只解析设置分区，`pageId` 一律返回 null，挂上去就是一颗写着「打开」
 * 却哪儿也不去的按钮。恢复它需要三件同批——外壳解析、有生产者、一条点下去真能到那一屏的
 * 用例——缺一件都是再造一次假指路。
 */
/**
 * 把一条已成立的信号变成提交请求，或 `undefined`（还没判、或参数描述不出一个桶）。
 *
 * 注意这里**不**拿平台键去和信号自带的 `dedupeKey` 比字面：两者是两个命名空间——信号键给
 * 卡片与信号存储用（`etf-flows:…:btc:2026-08-28`），通知键由平台按同一批参数生成
 * （`module-signal:ETF:…:BTC:2026-08-28`）。要求它们字面相等，就会为了对齐一个前缀去手拼键，
 * 那正是「不手拼 dedupeKey」这条要挡的事。这里只保证平台能凭参数构造出一个键。
 */
export function buildEtfOutflowSignalRequest(signal: ModuleSignal): NotificationSubmitRequest | undefined {
  if (signal.moduleId !== 'etf-flows' || signal.ruleId !== 'etf-outflow-3d') return undefined
  if (signal.readiness !== 'available' || signal.asset === null) return undefined

  const dedupeVars = signal.cadence.kind === 'trading-day'
    ? {
        builder: 'moduleSignal' as const,
        moduleId: signal.moduleId,
        ruleId: signal.ruleId,
        asset: signal.asset,
        observedAt: signal.observedAt,
        cadence: 'trading-day' as const
      }
    : {
        builder: 'moduleSignal' as const,
        moduleId: signal.moduleId,
        ruleId: signal.ruleId,
        asset: signal.asset,
        observedAt: signal.observedAt,
        cadence: 'intraday' as const,
        bucketMs: signal.cadence.bucketMs
      }

  // 参数描述不出一个桶时平台会拒收；那时不发，也不在这里替它拼一个。
  if (notificationDedupeBuilders.moduleSignal(dedupeVars) === undefined) return undefined

  return {
    eventTypeId: EVENT_IDS.signalTriggered,
    producerId: ETF_SIGNAL_NOTIFICATION_PRODUCER_ID,
    dedupeVars,
    actions: [],
    // 信号描述的那个交易日，不是提交这一下的时刻：晚到的流水仍属于它自己那天。
    occurredAt: signal.observedAt
  }
}

/**
 * 提交；一条通知发不出去不能把已经落库的行情判成失败，所以吞掉提交异常。
 *
 * 没有提交入口（例如未接通知的运行环境）时静默跳过——刷新本身照常完成。
 */
export async function notifyEtfOutflowSignals(
  submit: SignalNoticeSubmit | undefined,
  signals: readonly ModuleSignal[]
): Promise<void> {
  if (!submit) return
  const requests = signals.map(buildEtfOutflowSignalRequest).filter((request): request is NotificationSubmitRequest => request !== undefined)
  for (const request of requests) {
    try {
      await submit(request)
    } catch {
      // 通知不是事实来源：行情与状态已经写好了。
    }
  }
}
