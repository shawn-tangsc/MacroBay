import type { ChannelInboundService } from '../ChannelInboundService'
import { readLarkMessageEvent } from './LarkEventEnvelope'
import {
  createLarkLongConnection,
  type LarkLongConnection,
  type LarkLongConnectionEvent,
  type LarkProxyDecision
} from './LarkLongConnectionClient'
import { LarkRuntimeRepository } from './LarkRuntimeRepository'
import { resolveLarkTenantAuth } from './larkTenantAuth'
import { normalizeLarkEvent } from './LarkUpdateNormalizer'

/**
 * 飞书长连接宿主：把包装层（`LarkLongConnectionClient`）接到入站管道上。
 *
 * 两条纪律在这里**再成立一次**（不是只在包装层）：
 * 1. `resolveProxy` 解析不出来 → 宿主记 `lark-proxy-unresolved` 并不建立连接。
 *    包装层已经拒过一次，宿主这一层再拒一次是因为「这条通道到底有没有连上」必须由宿主说了算——
 *    否则运行时会以为自己跑起来了，而读者在界面上看到一个「已启用」却收不到消息。
 * 2. 确认只在**落库之后**：`inbound.receive` 的 `acknowledge` 里提交游标，回调抛错即不确认，
 *    让平台重推。反过来（先确认再落库）一次写失败就永久丢消息。
 */
export class LarkLongConnectionHost {
  private connection: LarkLongConnection | null = null
  private stopped = false

  constructor(private readonly deps: {
    channelId: string
    generation: number
    appId: string
    appSecret: string
    /** 平台那一侧：读网络设置 + 解析系统代理。返回 `null` = 解析不出来（不是直连）。 */
    resolveProxy: (targetUrl: string) => Promise<LarkProxyDecision | null>
    /** 平台那一侧：代理感知的 `fetch`。取 wss 地址那一跳走它，与收发同一个出网入口。 */
    getPlatformFetch: () => typeof fetch
    inbound: ChannelInboundService
    runtime: LarkRuntimeRepository
    hashEventKey: (eventKey: string) => Promise<string>
    isCurrent: () => boolean
    signal: AbortSignal
    handshakeTimeoutMs?: number
    /** 只给用例注入；生产用包装层的默认工厂。 */
    createConnection?: (input: { onEvent: (event: LarkLongConnectionEvent) => Promise<void> }) => LarkLongConnection
  }) {}

  async start(): Promise<boolean> {
    if (this.stopped || !this.currentGeneration()) return false
    // 域名跟着租户走：先问凭据属于哪一站，再按那一站建长连接与解析代理。
    // 判不出来就不建连接——拿错域名连上去会被网关踢，读者只会看到「已启用却收不到消息」。
    // 注入了 `createConnection` 的只有用例：那条路不发探测请求（用例要的是宿主自己的纪律）。
    const auth = this.deps.createConnection === undefined
      ? await resolveLarkTenantAuth({
        appId: this.deps.appId,
        appSecret: this.deps.appSecret,
        getPlatformFetch: this.deps.getPlatformFetch
      })
      : null
    if (auth !== null && !auth.ok) {
      this.audit(auth.code)
      return false
    }
    const connection = this.deps.createConnection?.({ onEvent: (event) => this.handle(event) }) ??
      createLarkLongConnection({
        appId: this.deps.appId,
        appSecret: this.deps.appSecret,
        resolveProxy: this.deps.resolveProxy,
        getPlatformFetch: this.deps.getPlatformFetch,
        ...(auth === null ? {} : { domain: auth.domain }),
        ...(this.deps.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: this.deps.handshakeTimeoutMs })
      })
    this.connection = connection
    // 包装层按同一条规则先拒一次；这里再判一次结果并落审计，运行时才不会以为自己连着。
    const result = await connection.connect({ onEvent: (event) => this.handle(event) })
    if (!result.ok) {
      this.audit(result.code)
      this.connection = null
      return false
    }
    return this.currentGeneration()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.connection?.close()
    this.connection = null
  }

  /** 事件 → 归一层 → 入站管道。抛错 = 不确认（平台会重推）。 */
  private async handle(event: LarkLongConnectionEvent): Promise<void> {
    if (this.stopped || !this.currentGeneration()) throw new Error('lark-host-not-current')
    const read = readLarkMessageEvent(event)
    if (read.kind === 'ignored') return
    if (read.kind === 'invalid') {
      this.audit('lark-event-invalid')
      // 坏形状重推也读不懂：不抛错（确认掉），免得一条坏消息把后面全堵住。
      return
    }
    const fact = normalizeLarkEvent(read.seam)
    if (!fact) {
      this.audit('lark-event-invalid')
      return
    }

    const result = await this.deps.inbound.receive({
      channelId: this.deps.channelId,
      generation: this.deps.generation,
      providerEventKey: fact.eventKey,
      ...(fact.messageKey ? { providerMessageKey: fact.messageKey } : {}),
      providerConversationKey: fact.conversationKey,
      providerUserKey: fact.userKey,
      conversationKind: fact.conversationKind,
      mentionedBot: fact.mentionedBot,
      ...(fact.text === undefined ? {} : { text: fact.text }),
      ...(fact.attachments ? { attachments: fact.attachments } : {}),
      acknowledge: async () => {
        const eventHash = await this.deps.hashEventKey(fact.eventKey)
        if (!this.currentGeneration()) throw new Error('lark-current-gate-failed')
        if (!this.deps.runtime.commitIfCurrent(this.deps.channelId, this.deps.generation, eventHash)) {
          this.audit('lark-sequence-stale')
          throw new Error('lark-sequence-stale')
        }
      }
    })
    if (result.disposition === 'retry') {
      // 管道没接住：抛错让平台重推（不会确认这一条）。
      this.audit('lark-inbound-retry')
      throw new Error('lark-inbound-retry')
    }
  }

  private currentGeneration(): boolean {
    return !this.deps.signal.aborted && this.deps.isCurrent()
  }

  private audit(code: string): void {
    if (!this.currentGeneration()) return
    this.deps.runtime.auditIfCurrent(this.deps.channelId, this.deps.generation, code)
  }
}
