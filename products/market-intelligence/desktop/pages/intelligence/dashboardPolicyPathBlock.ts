import type { PolicyPathReadResult } from '../../shared/ipc/policyPathClient'

/**
 * 利率路径卡这一刻该画什么：卡片 / 加载 / 五种「没有读数」之一。
 *
 * 判定顺序固定，先「源与格」后「这次读」：
 * 1. 格被读者关掉 → `cell-off`（与行情无关，先于一切读取）；
 * 2. 日历里的美联储日程源没启用 → `source-disabled`（这是「配了 Polymarket 以为配齐」的缺口）；
 * 3. 首读还没回来 → `loading`（**不许**画成失败）；
 * 4. 读到 → `card`；
 * 5. 没读到：`meeting-not-found` 是「源开着但库里没有下一场 FOMC 行」→ `schedule-not-read`；
 *    `calendar-query-unavailable` / `query-failed` 是瞬时失败 → `read-failed`；
 *    其余（客户端没接上 / 形状不符 / 请求不合法）→ `unavailable`，不给按钮。
 *
 * 这个函数只回答「哪条腿 / 哪种失败」，**源名与动作**由宿主按注册表接线，两件事不互相代替。
 */
export type PolicyPathBlockCause =
  | Readonly<{ kind: 'cell-off' }>
  | Readonly<{ kind: 'source-disabled' }>
  | Readonly<{ kind: 'schedule-not-read' }>
  | Readonly<{ kind: 'read-failed' }>
  | Readonly<{ kind: 'unavailable' }>

export type PolicyPathRender =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'card' }>
  | Readonly<{ kind: 'blocked'; block: PolicyPathBlockCause }>

export function resolvePolicyPathRender(input: Readonly<{
  cellEnabled: boolean
  /** `undefined` = 源状态表还没读到：不猜成「没启用」。 */
  scheduleEnabled: boolean | undefined
  settled: boolean
  result?: PolicyPathReadResult
}>): PolicyPathRender {
  if (!input.cellEnabled) return { kind: 'blocked', block: { kind: 'cell-off' } }
  if (input.scheduleEnabled === false) return { kind: 'blocked', block: { kind: 'source-disabled' } }
  if (!input.settled) return { kind: 'loading' }
  if (input.result?.state === 'available') return { kind: 'card' }
  const failureCode = input.result?.state === 'unavailable' ? input.result.failureCode : undefined
  if (failureCode === 'meeting-not-found') return { kind: 'blocked', block: { kind: 'schedule-not-read' } }
  if (failureCode === 'calendar-query-unavailable' || failureCode === 'query-failed') {
    return { kind: 'blocked', block: { kind: 'read-failed' } }
  }
  return { kind: 'blocked', block: { kind: 'unavailable' } }
}
