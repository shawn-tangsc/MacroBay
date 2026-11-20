import type { NotificationDeliveryState } from '@platform/notifications/contracts/notificationContracts'

import { dailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

/**
 * The reader's own push: publish the edition on screen, then push that record.
 *
 * The platform does the work (`redeliverPush` never creates a record, never rewrites its content and
 * never touches its count); this module only says *which edition* the reader is looking at, and turns
 * the answer back into something a card can show.
 *
 * No key is built here (契约 v2.32): the main process writes/locates the record and pushes it by its
 * `recordId`. A hand-built key is how a product ends up addressing another issue's record while the
 * reader sees an error about "this edition".
 */

export type BriefingPushEdition = Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }>

/**
 * Why the button cannot be pressed, or `null` when it can.
 *
 * Nine states in all — five a click can reach and four that disable it — and the four are kept apart
 * because their sentences are different: a missing channel is something the reader can fix, a missing
 * edition is something they can generate, and a non-primary language is a fact about this version.
 */
export type BriefingPushBlocked = 'generating' | 'no-edition' | 'not-ready' | 'non-primary-language'

/**
 * 一条通道这一次的结果：**发的是哪张、到没到**。
 *
 * `kind` 只在海报那一路写（`image` = 图 + 导读同一条，`text` = 该通道吃不下图、**明示降级**成
 * 纯导读）。界面上「只发了文字」要看得出来——把降级说成「已发图」就是假话。
 */
export type BriefingPushChannelResult = Readonly<{
  channelName?: string
  kind?: 'image' | 'text'
  state: 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'
  /** 平台原因码：界面翻成人话，码不上屏。 */
  reason?: string
}>

/**
 * 这一次发布的结果。**「发出去了」与「收到了」是两件事**：聚合档照抄平台四档，
 * 逐通道行才是读者要数的东西——`failed` 也属于「发布动作做完了」，不是「请求没发出去」
 * （后者是 `state: 'failed'` 那一支，带具名原因）。
 */
export type BriefingPushOutcome =
  | Readonly<{
      state: 'result'
      delivery: 'sent-accepted' | 'sent-unconfirmed' | 'failed' | 'queued'
      /** 聚合档的原因（例如 `push-unavailable` = 一条可用通道都没有）：与逐通道行的原因分开。 */
      deliveryReason?: string
      /** 多通道：每条一行，总括数字与逐条说明都从这些行来；老回执没有就不画。 */
      channels?: readonly BriefingPushChannelResult[]
    }>
  | Readonly<{ state: 'failed'; reason: BriefingPushFailure }>

/**
 * The ways a send can fail, in the reader's terms.
 *
 * `redeliver-*` is the platform's own vocabulary and never appears on screen; the mismatch case has its
 * own sentence because "you regenerated, so the phone has the older issue" is not a failure to send.
 */
export type BriefingPushFailure =
  | 'channel-not-configured'
  | 'channel-disconnected'
  | 'channel-rate-limited'
  /** 这个版本没有推送入口（产品桥没装配）——不是「服务没启动」，是能力不在。 */
  | 'capability-missing'
  /** 请求根本没发出去：桥抛了。原文进日志，界面只说事实。 */
  | 'invoke-failed'
  /** 回了一个我们不认识的结果（形状或 kind 对不上）。 */
  | 'receipt-unknown'
  | 'push-paused'
  | 'record-missing'
  | 'edition-mismatch'
  | 'surface-invalid'
  /**
   * 主进程拒了这次带图的发布（导读超长 / 来源对不上 / 图太大）。渲染层已经先判过前两个，
   * 走到这里多半是版次对不上——**不偷偷降级成纯文字**（那是读者自己的选择）。
   */
  | 'poster-refused'
  /**
   * 海报没渲染出来：**一次 IPC 都没发**。产品键就叫 `poster-render-failed`（不是平台码）。
   * 与 `invoke-failed` 分开：一个是我们自己没出图，一个是请求出去了没回来。
   */
  | 'poster-render-failed'

/**
 * The channel the phone receives through, read from the platform rather than named here.
 *
 * `wired: undefined` means the platform answered without saying: the capabilities are unknown, so the
 * button stays pressable and a missing channel is reported by the send itself. Only an explicit
 * `false` disables it — "this build cannot send" is a claim, and a claim needs evidence.
 */
export type BriefingPushChannel = Readonly<{
  wired: boolean | undefined
  name: string | undefined
  /**
   * 读者配置里「可投递」的通道条数。**发送中那句「正在发到 {n} 条通道…」只读它**：
   * 真正的目标是平台运行时判定的就绪通道，渲染层点之前看不到——所以这是个**乐观上界**，
   * 回执回来之后一切以逐通道行为准（数不对时以回执为准，不拿这个数去覆盖结果）。
   */
  deliverableCount: number | undefined
}>

/**
 * 通道名从平台的投递设置里读（纯展示）；**发布本身走产品 IPC**——先写/更新记录再重投是主进程的事，
 * 渲染层不该自己拼那两步。
 */
type ChannelBridge = Readonly<{
  getDeliverySettings?: () => Promise<{ pushWired?: boolean; channels?: readonly unknown[] }>
}>

function channelBridge(): ChannelBridge | undefined {
  const platform = (globalThis as { window?: { platform?: { notifications?: unknown } } }).window?.platform
  return platform?.notifications as ChannelBridge | undefined
}

/** Whether this build can publish at all; the fourth disabled state reads it. */
export function briefingPushAvailable(): boolean {
  const products = (globalThis as { window?: { platform?: { products?: { invoke?: unknown } } } }).window?.platform?.products
  return typeof products?.invoke === 'function'
}

/**
 * Which channel would carry this publication, and whether the port that carries it is assembled.
 *
 * The name is the platform's own label for the channel the reader configured — never a product word and
 * never a channel brand: a hard-coded name is how a build keeps announcing one channel after the reader
 * switched to another. When several exist, the deliverable one is the one a send would reach.
 */
export async function readBriefingPushChannel(): Promise<BriefingPushChannel> {
  const bridge = channelBridge()
  if (!bridge) return { wired: false, name: undefined, deliverableCount: undefined }
  if (typeof bridge.getDeliverySettings !== 'function') {
    return { wired: undefined, name: undefined, deliverableCount: undefined }
  }
  try {
    const settings = await bridge.getDeliverySettings()
    const channels = Array.isArray(settings?.channels) ? settings.channels : []
    const deliverable = channels.filter((entry) => isRecord(entry) && entry.deliverable === true)
    const named = deliverable[0] ?? channels.find(isRecord)
    const name = isRecord(named) && typeof named.name === 'string' ? named.name.trim() : ''
    return {
      // Absent `pushWired` is not `false`: an older platform that does not answer the question must not
      // disable a button that would have worked.
      wired: typeof settings?.pushWired === 'boolean' ? settings.pushWired : undefined,
      name: name === '' ? undefined : name,
      deliverableCount: deliverable.length
    }
  } catch {
    return { wired: undefined, name: undefined, deliverableCount: undefined }
  }
}

/**
 * Send the edition on screen.
 *
 * A rejection is mapped to one of the reader's reasons; every one of them is a sentence, never a code.
 * `sent-unconfirmed` is a success with its own wording: the platform's result says the request left but
 * no receipt came back, and calling that "sent" is what the copy forbids.
 */
export async function redeliverBriefingPush(
  edition: BriefingPushEdition,
  /**
   * 发布用的海报字节（1080 宽、1x）。**不传就是只发文字**：读者选的那个动作，或这一版没有可渲染的纸。
   * 渲染失败时调用方一次 IPC 都不发——所以这里只收「确定的字节」。
   */
  poster?: Readonly<{ bytes: Uint8Array; mime: string }>
): Promise<BriefingPushOutcome> {
  if (!briefingPushAvailable()) return fail(edition, 'capability-missing', 'bridge-missing')
  let result: unknown
  try {
    // 主进程的三步：先按这一版写/更新完成记录（只记不发），把海报字节暂存，再投递那条记录。
    // 库里有记录时第一步只是合并，不会多一行；库里没有时它就补上，读者不必先去别处「生成一条通知」。
    result = await dailyBriefingClient.publishToPhone({
      date: edition.date,
      periodId: edition.periodId,
      locale: edition.locale,
      ...(poster === undefined ? {} : { poster })
    })
  } catch (error) {
    return fail(edition, 'invoke-failed', errorText(error))
  }
  if (!isRecord(result)) return fail(edition, 'receipt-unknown', `shape:${typeof result}`)
  if (result.kind === 'rejected') return fail(edition, rejectionReason(result.reason), `rejected:${String(result.reason)}`)
  if (result.kind !== 'accepted') return fail(edition, 'receipt-unknown', `kind:${String(result.kind)}`)
  const delivery = result.delivery as Partial<NotificationDeliveryState> | undefined
  const channels = readChannelResults(delivery)
  // 聚合档原样照抄四档（缺省按 `sent-unconfirmed`：拿到「accepted」却没有投递证据，只能是「不知道」）。
  const state = DELIVERY_STATES.find((candidate) => candidate === delivery?.state) ?? 'sent-unconfirmed'
  const deliveryReason = typeof delivery?.reason === 'string' && delivery.reason.length > 0
    ? { deliveryReason: delivery.reason }
    : {}
  return { state: 'result', delivery: state, ...deliveryReason, ...(channels === undefined ? {} : { channels }) }
}

/** The platform's five rejections, in the reader's terms. */
function rejectionReason(code: unknown): BriefingPushFailure {
  switch (code) {
    case 'redeliver-target-missing': return 'record-missing'
    // 主进程先写后推之后，遇到的多半是「这一版根本还没生成」；读者要做的同一件事：先去生成。
    case 'edition-missing': return 'record-missing'
    case 'redeliver-edition-mismatch': return 'edition-mismatch'
    case 'redeliver-surface-invalid': return 'surface-invalid'
    // 带图发布被整条拒：不降级、不重试成纯文字，读者要用「只发文字」自己选。
    case 'poster-refused': return 'poster-refused'
    case 'push-paused': return 'push-paused'
    case 'channel-missing': return 'channel-not-configured'
    // 主进程说「重投入口没装配」＝这个版本没有这个能力，不是「服务没启动」。
    case 'runtime-unavailable': return 'capability-missing'
    // 认不出的拒绝码也是「回执不认识」，不冒充成「服务没启动」。
    default: return 'receipt-unknown'
  }
}

const CHANNEL_STATES = ['queued', 'sent-accepted', 'sent-unconfirmed', 'failed'] as const
const DELIVERY_STATES = CHANNEL_STATES

/**
 * 逐通道结果：读形状、不猜。认不出一条通道就跳过那一行（计数按真实行数，不编一行补位）；
 * `kind` 只认 `image` / `text`，别的值当没写——形态写错不该被当成「发了图」。
 */
function readChannelResults(push: unknown): readonly BriefingPushChannelResult[] | undefined {
  if (!isRecord(push) || !Array.isArray(push.channels)) return undefined
  const rows: BriefingPushChannelResult[] = []
  for (const entry of push.channels) {
    if (!isRecord(entry)) continue
    const state = CHANNEL_STATES.find((candidate) => candidate === entry.state)
    if (state === undefined) continue
    rows.push({
      state,
      ...(typeof entry.channelName === 'string' && entry.channelName.length > 0 ? { channelName: entry.channelName } : {}),
      ...(entry.kind === 'image' || entry.kind === 'text' ? { kind: entry.kind } : {}),
      ...(typeof entry.reason === 'string' && entry.reason.length > 0 ? { reason: entry.reason } : {})
    })
  }
  return rows.length === 0 ? undefined : rows
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300)
  return String(error).slice(0, 300)
}

/**
 * 失败的分支互不冒充：能力不在／请求没发出／回执不认识，是三种不同的病，读者的话也不同。
 *
 * 诊断走渲染层 `console.error`——主进程的 `createRendererProcessLog` 会把它作为
 * `console-message` 落进 app.log（实测过），所以这里不是「只打终端」。原文（异常、形状、
 * 拒绝码）只进日志，不上界面：读者要的是一句人话，排障要的是原文。
 */
function fail(edition: BriefingPushEdition, reason: BriefingPushFailure, detail: string): BriefingPushOutcome {
  console.error(JSON.stringify({
    marker: 'MI_DAILY_BRIEF_PUSH_FAILED',
    reason,
    detail,
    edition: { date: edition.date, periodId: edition.periodId, locale: edition.locale },
    at: new Date().toISOString()
  }))
  return { state: 'failed', reason }
}
