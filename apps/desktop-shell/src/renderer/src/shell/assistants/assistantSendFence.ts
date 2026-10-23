/**
 * Owner: apps/desktop-shell renderer / shell（PLAT-64）。
 *
 * 输入框「发送中」状态与 stream 终止事件的**归属判定**（纯函数，不碰 React）。
 *
 * 背景：`AssistantPage` 曾把这段判断内联，改写后丢了「首发 vs 既有话题」的区别，于是既有话题在下一次
 * `streamOpen` 还没返回执行 id 时，会被**上一次执行**的 done/error 解锁（输入框提前回到 Send）。这里把
 * 判定收成一个可单测的小状态机：
 *
 * - 新建话题的首发（`acceptsEarlyTerminalEvents`）：这条话题只能由本次发送产生执行 ⇒ 执行 id 回来之前
 *   到达的终止事件一定是本次的，可以解锁（首条消息常常在 React 重绑监听前就结束）；
 * - 既有话题：早到的事件可能是上一条执行的回声 ⇒ 先记下它的执行 id，等 `streamOpen` 返回本次执行 id 后
 *   只有**属于本次**的那条才算数；不属于则忽略（下次真正的终止事件再来解锁）。
 *
 * 纯函数形态让"回声不会提前解锁"这条不变量直接可测，不必靠渲染时序复现。
 */

export type AssistantSendIdentity = {
  topicId: string
  executionIds: readonly string[] | null
  acceptsEarlyTerminalEvents: boolean
}

export type AssistantSendFence = {
  send: AssistantSendIdentity | null
  /** 执行 id 未知时到达的 done/error 所属执行 id（只有已有话题会攒，见上）。 */
  earlyTerminalExecutionIds: readonly string[]
}

export type AssistantSendSettlement = {
  fence: AssistantSendFence
  settled: boolean
}

export const idleAssistantSendFence: AssistantSendFence = {
  send: null,
  earlyTerminalExecutionIds: []
}

export function beginSend(
  topicId: string,
  acceptsEarlyTerminalEvents: boolean
): AssistantSendFence {
  return { send: { topicId, executionIds: null, acceptsEarlyTerminalEvents }, earlyTerminalExecutionIds: [] }
}

/** `streamOpen` 返回后记录本次执行 id，并结算打开期间攒下的"可能属于本次"的终止事件。 */
export function recordSendExecutions(
  fence: AssistantSendFence,
  topicId: string,
  executionIds: readonly string[]
): AssistantSendSettlement {
  const send = fence.send
  if (!send || send.topicId !== topicId) return { fence, settled: false }
  const earlyTerminalArrived = fence.earlyTerminalExecutionIds.some((id) => executionIds.includes(id))
  return {
    fence: { send: { ...send, executionIds }, earlyTerminalExecutionIds: [] },
    settled: earlyTerminalArrived
  }
}

/**
 * 一条终止事件是否解锁输入框。
 * `executionId` 缺失（老事件/仅话题级终态）时按 `executionIds === null` 的同一套规则处理。
 */
export function settleSend(
  fence: AssistantSendFence,
  topicId: string,
  executionId?: string
): AssistantSendSettlement {
  const send = fence.send
  if (!send || send.topicId !== topicId) return { fence, settled: false }
  if (send.executionIds === null) {
    if (send.acceptsEarlyTerminalEvents) return { fence: { send: null, earlyTerminalExecutionIds: [] }, settled: true }
    return {
      fence: {
        ...fence,
        earlyTerminalExecutionIds: executionId
          ? [...fence.earlyTerminalExecutionIds, executionId]
          : fence.earlyTerminalExecutionIds
      },
      settled: false
    }
  }
  if (executionId && !send.executionIds.includes(executionId)) return { fence, settled: false }
  return { fence: { send: null, earlyTerminalExecutionIds: [] }, settled: true }
}

/**
 * 话题级终态快照（`onStreamStatusChanged` 的 done/aborted/error）能否用来解锁：
 * 执行 id 还没回来、且这是既有话题时不行 —— 那条快照可能属于上一次执行。
 */
export function acceptsStatusTerminal(fence: AssistantSendFence, topicId: string): boolean {
  const send = fence.send
  if (!send || send.topicId !== topicId) return true
  return send.executionIds !== null || send.acceptsEarlyTerminalEvents
}

export function abandonSend(fence: AssistantSendFence, topicId?: string): AssistantSendFence {
  if (topicId && fence.send?.topicId !== topicId) return fence
  return idleAssistantSendFence
}
