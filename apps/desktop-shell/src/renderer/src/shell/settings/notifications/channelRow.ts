import type { ChannelDeliveryTargetView } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'

/**
 * 「发送到频道」这一行的**纯模型**：这一行现在到底处在哪种处境，以及右侧能放什么。
 *
 * 为什么单独一个文件：这一行最容易画错的不是布局，是**把「还没选」说成「没有」**，
 * 或者反过来——把「有频道但目标没绑」画成一个下拉，读者以为选了就会发出去。
 * 于是这里只做一件事：拿三份事实算出一个闭集形态，句子和控件由视图按形态取。
 *
 * 三份事实都来自主进程同一个只读投影（`getDeliverySettings`）：
 * - `channels`：频道目录的投递投影，`deliverable` 才是「能发」；
 * - `channelId`：读者选的那条（`null` = 没选，契约里这就是「关」）；
 * - `lastPushFailureAt`：**已存记录里**最近一次推送失败的时刻，不给 pushBackoff 加字段。
 */

/** 选择器里能出现的那几条：**只列可投递的**，未接入、未验证的一律不出现（U10）。 */
export type ChannelChoice = Readonly<{ id: string; name: string }>

/** 目标的三种形态就是投影给的三种：不替读者挑会话，也不猜它是谁。 */
export type ChannelBoundTargetKind = 'direct' | 'group' | 'channel'

export type ChannelRowState =
  /** 没有任何一条可投递频道：不画选择器（空下拉是更糟的谎）。 */
  | Readonly<{ kind: 'not-wired' }>
  /** 有可投递频道，但读者还没选：推送就是关着，别假装它是「未接入」。 */
  | Readonly<{ kind: 'unselected'; choices: readonly ChannelChoice[] }>
  /** 选了频道，但它还没绑定目标：发不出去，且不该由这一页去挑会话。 */
  | Readonly<{ kind: 'unbound'; choices: readonly ChannelChoice[]; selectedId: string; channelName: string }>
  /** 绑了多个会话：**不发、不猜**，让读者去频道页只留一个。 */
  | Readonly<{ kind: 'ambiguous'; choices: readonly ChannelChoice[]; selectedId: string; channelName: string }>
  /** 可用，但最近一次没发出去：这是**过去的结论**，不是当前的开关状态。 */
  | Readonly<{
    kind: 'failed'
    choices: readonly ChannelChoice[]
    selectedId: string
    channelName: string
    target: ChannelBoundTargetKind
    failedAt: string
    /** 失败原因码（闭集，`ChannelPushReason`）；`null` = 记录里没写原因，界面就说「原因没有上报」。 */
    failedReason: string | null
  }>
  /** 可用且没在失败态：**成功不打标**，一行都不写。 */
  | Readonly<{
    kind: 'ready'
    choices: readonly ChannelChoice[]
    selectedId: string
    channelName: string
    target: ChannelBoundTargetKind
  }>

export type ChannelRowInput = Readonly<{
  channels: readonly ChannelDeliveryTargetView[]
  channelId: string | null
  lastPushFailureAt: string | null
  lastPushFailureReason: string | null
}>

export function buildChannelRowState(input: ChannelRowInput): ChannelRowState {
  const choices = input.channels
    .filter((channel) => channel.deliverable)
    .map((channel) => ({ id: channel.id, name: channel.name }))
  // 一条都发不出去：这里只说「没有」，选择器不出现——一个空下拉会把「没有」说成「挑一个」。
  if (choices.length === 0) return { kind: 'not-wired' }

  const selected = choices.find((choice) => choice.id === input.channelId)
  // 选过的那条被停用或不再可投递时，回到「没选」：读者不被告知一条已经不存在的频道。
  if (selected === undefined) return { kind: 'unselected', choices }

  const target = input.channels.find((channel) => channel.id === selected.id)?.target
  if (target === undefined || target.kind === 'unbound') {
    return { kind: 'unbound', choices, selectedId: selected.id, channelName: selected.name }
  }
  if (target.kind === 'ambiguous') {
    return { kind: 'ambiguous', choices, selectedId: selected.id, channelName: selected.name }
  }
  const base = {
    choices,
    selectedId: selected.id,
    channelName: selected.name,
    target: target.conversationKind
  }
  return input.lastPushFailureAt === null
    ? { kind: 'ready', ...base }
    : { kind: 'failed', ...base, failedAt: input.lastPushFailureAt, failedReason: input.lastPushFailureReason }
}

/**
 * 订阅清单的「频道」列出不出现：**频道就绪 = 已接入 + 已选 + 目标已绑定**（规范 §2.2）。
 *
 * 未就绪时整列不渲染，而不是画一串禁用的勾：禁用的勾会让读者以为「勾上就能推到手机」，
 * 而那一列勾了也不会响。失败态仍算就绪——它绑得好好的，只是上一次没发出去。
 */
export function channelColumnReady(state: ChannelRowState): boolean {
  return state.kind === 'ready' || state.kind === 'failed'
}
