import { EventDispatcher, WSClient as SdkWsClient } from '@larksuiteoapi/node-sdk'
import { ProxyAgent } from 'proxy-agent'

import { larkOrigins, type LarkDomain } from './LarkContracts'

/**
 * 飞书长连接的**包装层**：SDK 只出现在这个文件里，平台拿到的永远是我们自己的形状。
 *
 * 为什么加 `@larksuiteoapi/node-sdk`（锁 `1.76.0`，不带 `^`）：
 * 它的长连接客户端在构造参数里预留了 **`agent`**、**`httpInstance`**、**`handshakeTimeoutMs`** 三个注入位
 * （`IConstructorParams`），建连那行就是 `new WebSocket(connectUrl, { agent })`。所以代理可以由我们注入，
 * 不需要自实现帧格式、也不需要改走 webhook。
 *
 * 两个注入位都要用上，缺一个就漏一条出网：
 * - `agent` —— socket 本身（建连）；
 * - `httpInstance` —— **先取 wss 地址那一跳**（`POST /callback/ws/endpoint`）。SDK 默认用自带 axios，
 *   只认 `HTTP(S)_PROXY` 环境变量、不读应用网络设置，应用里又没有那个变量；不注入就是一条绕过
 *   平台代理的直连通道，现象是「凭据对、报 `lark-connect-failed`」。
 *
 * 三条纪律（本文件就是它们唯一落地的地方）：
 * 1. **代理只从应用网络设置来**：`resolveProxy` 由组合根注入（平台那一侧读设置并解析系统代理），
 *    取地址那一跳复用同一个平台 `fetch`；
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

/**
 * 取 wss 地址那一跳的出网入口（SDK 的 `httpInstance` 注入位）。
 *
 * 为什么需要它：SDK 默认用自带的 axios 发这个请求，**不读应用网络设置**，只认 `HTTP(S)_PROXY`
 * 环境变量——而应用从不设那两个变量。于是「凭据对、长连接建不起来」会在这里发生，
 * 表现成 `lark-connect-failed`，看着像适配器坏了。注入平台 fetch 之后，这一跳与收发走同一个代理。
 *
 * 形状照 SDK 的用法：`request(config)` 直接回**响应体**（SDK 的响应拦截器已经解过一层）。
 */
export type LarkHttpInstance = {
  request: (config: {
    url: string
    method?: string
    data?: unknown
    headers?: Record<string, string>
    timeout?: number
  }) => Promise<unknown>
}

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
  /** 取 wss 地址那一跳：由平台 fetch 承担，不落回 SDK 自带的 axios。 */
  httpInstance: LarkHttpInstance
  /** 租户所属那一站：SDK 的 `domain` 与代理目标都从它取，不许在工厂里再写字面量。 */
  domain: LarkDomain
  /** SDK 首次握手成功 / 终态失败的回调：宿主据此落「就绪」「被关闭」两行诊断。 */
  onReady?: () => void
  onError?: (error: Error) => void
}) => WsClientLike

export type LarkLongConnectionDeps = {
  appId: string
  appSecret: string
  /** 平台那一侧：读网络设置 + 解析系统代理。返回 `null` = 解析不出来（不是直连）。 */
  resolveProxy: (targetUrl: string) => Promise<LarkProxyDecision | null>
  /** 平台那一侧：代理感知的 `fetch`。取 wss 地址那一跳走它，与收发同一个出网入口。 */
  getPlatformFetch: () => typeof fetch
  /** 只给用例注入；生产用默认的 SDK 工厂。 */
  createWsClient?: LarkWsClientFactory
  /** 租户所属那一站：缺省是历史默认的国际站；启用自检会按凭据探测后传真实值。 */
  domain?: LarkDomain
  /** 长连接就绪（首次握手成功）/ 终态失败：宿主用它们写诊断行，绝不吞掉。 */
  onReady?: () => void
  onError?: (error: Error) => void
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
      const target = larkWsTargetFor(deps.domain ?? 'lark')
      const decision = await deps.resolveProxy(target)
      if (!decision) return { ok: false, code: 'lark-proxy-unresolved' }

      const factory = deps.createWsClient ?? defaultWsClientFactory
      try {
        client = factory({
          appId: deps.appId,
          appSecret: deps.appSecret,
          ...(decision.kind === 'proxy' ? { agent: proxyAgentFor(decision.url) } : {}),
          handshakeTimeoutMs: deps.handshakeTimeoutMs ?? 15_000,
          // 取 wss 地址那一跳也走平台的出网入口：SDK 默认的 axios 不读应用网络设置。
          httpInstance: createLarkHttpInstance(deps.getPlatformFetch),
          // 域名跟着租户走：中国站租户在国际站会被 1000040351 踢掉。
          domain: deps.domain ?? 'lark',
          ...(deps.onReady === undefined ? {} : { onReady: deps.onReady }),
          ...(deps.onError === undefined ? {} : { onError: deps.onError })
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

/** 飞书长连接的接入点：只用于解析代理，从来不直接连它。按租户所属那一站取。 */
export function larkWsTargetFor(domain: LarkDomain): string {
  return larkOrigins[domain]
}

export const larkWsTarget = larkWsTargetFor('lark')

function proxyAgentFor(proxyUrl: string): unknown {
  // 与平台 `platformWebSocket` 同一写法：`proxy-agent` 必须用对象形状，传字符串不生效。
  return new ProxyAgent({ getProxyForUrl: async () => proxyUrl })
}

/**
 * SDK 取 wss 地址那一跳的出网入口：平台 `fetch`，与收发同一个代理。
 *
 * 三处细节都是照 SDK 的用法来的，不是猜的：
 * - 它读 `response` 的**响应体**（默认实例的响应拦截器已经解过一层），所以这里回 `json()`；
 * - 它只认 `code` / `data.URL` / `msg`，别的字段不读；
 * - 失败要**抛错**——SDK 把异常当「这次拉不到地址」（可重试），而回一个空对象会让它拿空 URL 去连。
 */
export function createLarkHttpInstance(getPlatformFetch: () => typeof fetch): LarkHttpInstance {
  return {
    async request(config) {
      const response = await getPlatformFetch()(config.url, {
        method: (config.method ?? 'post').toUpperCase(),
        headers: { 'content-type': 'application/json; charset=utf-8', ...(config.headers ?? {}) },
        body: JSON.stringify(config.data ?? {}),
        signal: AbortSignal.timeout(config.timeout ?? 15_000)
      })
      if (!response.ok) throw new Error(`lark-http-${response.status}`)
      return await response.json()
    }
  }
}

/** SDK 的构造参数类型：只取它的 `httpInstance` 形状做一次显式收窄，不把 SDK 的类型带到别处。 */
type SdkWsClientParams = ConstructorParameters<typeof SdkWsClient>[0]

/** 默认工厂：只有这里出现 SDK。`agent` 由调用方决定，直连时整个键都不传。 */
const defaultWsClientFactory: LarkWsClientFactory = (options) => {
  return new SdkWsClient({
    appId: options.appId,
    appSecret: options.appSecret,
    ...(options.agent === undefined ? {} : { agent: options.agent }),
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    // 不传它，SDK 会用自带的 axios 直连——那正是这一笔要堵的口子。
    // 收窄是必要的：SDK 声明的是 axios 实例（带 get/post/delete…），我们只实现它实际用到的那一个方法。
    httpInstance: options.httpInstance as unknown as SdkWsClientParams['httpInstance'],
    // 取 wss 地址打哪个 origin 由同一处常量决定，与 REST 基址同源。
    domain: larkOrigins[options.domain],
    ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    autoReconnect: false
  }) as unknown as WsClientLike
}

/**
 * SDK 终态错误 → 一个**短码**（写进诊断审计，不含 URL、凭据、正文）。
 *
 * 飞书被网关踢下来的典型形态是 `1000040351 Incorrect domain name`：数字码必须在库里看得见，
 * 否则「连上了但收不到消息」永远分不出是域名错、网络错还是没订阅。
 */
export function larkCloseCode(error: unknown): string {
  const record = (error ?? {}) as { code?: unknown; errCode?: unknown; message?: unknown }
  const direct = record.code ?? record.errCode
  if (typeof direct === 'number' || (typeof direct === 'string' && direct.trim() !== '')) return String(direct)
  const message = typeof record.message === 'string' ? record.message : ''
  const matched = /\b(\d{6,})\b/u.exec(message)
  return matched?.[1] ?? 'unknown'
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
