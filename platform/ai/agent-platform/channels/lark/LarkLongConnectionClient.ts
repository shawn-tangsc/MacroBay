import { EventDispatcher, WSClient as SdkWsClient } from '@larksuiteoapi/node-sdk'
import { ProxyAgent } from 'proxy-agent'

/**
 * 飞书长连接的**包装层**：SDK 只出现在这个文件里，平台拿到的永远是我们自己的形状。
 *
 * 为什么加 `@larksuiteoapi/node-sdk`（锁 `1.76.0`，不带 `^`）：
 * 它的长连接客户端在构造参数里预留了 **`agent`**、**`httpInstance`**、**`handshakeTimeoutMs`** 三个注入位
 * （`IConstructorParams`），建连那行就是 `new WebSocket(connectUrl, { agent })`。所以代理可以由我们注入，
 * 不需要自实现帧格式、也不需要改走 webhook。
 *
 * 三条纪律（本文件就是它们唯一落地的地方）：
 * 1. **代理只从应用网络设置来**：`resolveProxy` 由组合根注入（平台那一侧读设置并解析系统代理）；
 * 2. **解析不出代理就不连**：`resolveProxy` 返回 `null`（解析失败，不是「直连」）时直接失败，
 *    绝不落到一个默认直连上——这台机器直连飞书必不通，而那种失败看起来会像「适配器坏了」；
 * 3. **SDK 的类型不外泄**：对外只有 `LarkLongConnectionEvent`（我们自己定义），事件体的解释在下一层。
 */

/** 代理判定的三种答案：显式直连、走代理、解析不出来（不连）。 */
export type LarkProxyDecision = { kind: 'direct' } | { kind: 'proxy'; url: string }

/** 我们自己的事件形状：SDK 的事件体只作为不透明负载往下传，解释权在归一化那一层。 */
export type LarkLongConnectionEvent = Readonly<{
  eventId: string
  eventType: string
  payload: unknown
}>

export type LarkLongConnectionResult =
  | { ok: true }
  | { ok: false; code: 'lark-proxy-unresolved' | 'lark-connect-failed' }

type WsClientLike = {
  start: (input: { eventDispatcher: unknown }) => Promise<void> | void
  close: () => void
}

export type LarkWsClientFactory = (options: {
  appId: string
  appSecret: string
  /** 只有解析到代理时才带；直连时**不带**这个键。 */
  agent?: unknown
  handshakeTimeoutMs: number
}) => WsClientLike

export type LarkLongConnectionDeps = {
  appId: string
  appSecret: string
  /** 平台那一侧：读网络设置 + 解析系统代理。返回 `null` = 解析不出来（不是直连）。 */
  resolveProxy: (targetUrl: string) => Promise<LarkProxyDecision | null>
  /** 只给用例注入；生产用默认的 SDK 工厂。 */
  createWsClient?: LarkWsClientFactory
  /** 握手超时：代理挂住时不让它无限等。 */
  handshakeTimeoutMs?: number
}

export type LarkLongConnection = {
  /**
   * `onEvent` 的返回值就是「这条我处理完了」：**抛错则不确认**，让平台重推。
   * 所以调用方必须在它里面等到「落库 + 提交游标」都完成才返回。
   */
  connect: (handlers: { onEvent: (event: LarkLongConnectionEvent) => Promise<void> | void }) => Promise<LarkLongConnectionResult>
  close: () => void
}

export function createLarkLongConnection(deps: LarkLongConnectionDeps): LarkLongConnection {
  let client: WsClientLike | null = null

  return {
    async connect(handlers) {
      const decision = await deps.resolveProxy(larkWsTarget)
      if (!decision) return { ok: false, code: 'lark-proxy-unresolved' }

      const factory = deps.createWsClient ?? defaultWsClientFactory
      try {
        client = factory({
          appId: deps.appId,
          appSecret: deps.appSecret,
          ...(decision.kind === 'proxy' ? { agent: proxyAgentFor(decision.url) } : {}),
          handshakeTimeoutMs: deps.handshakeTimeoutMs ?? 15_000
        })
        await client.start({ eventDispatcher: createDispatcher(handlers.onEvent) })
        return { ok: true }
      } catch {
        client?.close()
        client = null
        return { ok: false, code: 'lark-connect-failed' }
      }
    },
    close() {
      client?.close()
      client = null
    }
  }
}

/** 飞书长连接的接入点：只用于解析代理，从来不直接连它。 */
export const larkWsTarget = 'https://open.larksuite.com'

function proxyAgentFor(proxyUrl: string): unknown {
  // 与平台 `platformWebSocket` 同一写法：`proxy-agent` 必须用对象形状，传字符串不生效。
  return new ProxyAgent({ getProxyForUrl: async () => proxyUrl })
}

/** 默认工厂：只有这里出现 SDK。`agent` 由调用方决定，直连时整个键都不传。 */
const defaultWsClientFactory: LarkWsClientFactory = (options) => {
  return new SdkWsClient({
    appId: options.appId,
    appSecret: options.appSecret,
    ...(options.agent === undefined ? {} : { agent: options.agent }),
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    autoReconnect: false
  }) as unknown as WsClientLike
}

/** 只订阅消息事件，并把 SDK 的回调折成我们自己的形状。 */
function createDispatcher(onEvent: (event: LarkLongConnectionEvent) => Promise<void> | void): unknown {
  const dispatcher = new EventDispatcher({})
  dispatcher.register({
    // 返回值/抛错由 SDK 决定是否确认：抛错即不确认，平台会重推。
    'im.message.receive_v1': async (payload: unknown) => {
      await onEvent(toLongConnectionEvent(payload))
    }
  })
  return dispatcher
}

/** SDK 事件体 → 我们自己的形状。读不出来的字段留空，解释在归一化那一层。 */
export function toLongConnectionEvent(payload: unknown): LarkLongConnectionEvent {
  const record = (payload ?? {}) as { event?: { event_id?: unknown; type?: unknown }; header?: { event_id?: unknown; event_type?: unknown } }
  const eventId = typeof record.header?.event_id === 'string'
    ? record.header.event_id
    : typeof record.event?.event_id === 'string' ? record.event.event_id : ''
  const eventType = typeof record.header?.event_type === 'string'
    ? record.header.event_type
    : typeof record.event?.type === 'string' ? record.event.type : 'im.message.receive_v1'
  return Object.freeze({ eventId, eventType, payload })
}
