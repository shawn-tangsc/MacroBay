/**
 * WeChat iLink Bot protocol surface used by the channel host.
 * Injectable for tests; default implementation uses platform fetch.
 */

export type WeChatCredentials = {
  token: string
  baseUrl: string
  accountId: string
  userId: string
}

export type WeChatIncomingMessage = {
  userId: string
  text: string
  contextToken: string
}

export type WeChatProtocol = {
  hasCredentials: () => Promise<boolean>
  login: (options?: { force?: boolean; signal?: AbortSignal }) => Promise<WeChatCredentials>
  onMessage: (handler: (message: WeChatIncomingMessage) => void | Promise<void>) => void
  run: () => Promise<void>
  stop: () => void
  send: (userId: string, text: string) => Promise<void>
  sendTyping: (userId: string) => Promise<void>
}

export type WeChatProtocolOptions = {
  tokenPath: string
  fetchImpl?: typeof fetch
  onQrUrl?: (url: string) => void
  onError?: (error: unknown) => void
  /** Test seam: seed credentials without QR login. */
  initialCredentials?: WeChatCredentials | null
  /** Test seam: custom credential IO. */
  loadCredentials?: (tokenPath: string) => Promise<WeChatCredentials | null>
  saveCredentials?: (tokenPath: string, credentials: WeChatCredentials) => Promise<void>
}

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'

export function createWeChatProtocol(options: WeChatProtocolOptions): WeChatProtocol {
  let credentials = options.initialCredentials ?? null
  let stopped = false
  const contextTokens = new Map<string, string>()
  let inboundHandler: ((message: WeChatIncomingMessage) => void | Promise<void>) | null = null

  async function resolveFetch(): Promise<typeof fetch> {
    if (options.fetchImpl) return options.fetchImpl
    const { getPlatformFetch } = await import('../../../../network/platformFetch')
    return getPlatformFetch()
  }

  async function loadCredentials(): Promise<WeChatCredentials | null> {
    if (options.loadCredentials) return options.loadCredentials(options.tokenPath)
    if (credentials) return credentials
    return null
  }

  async function saveCredentials(next: WeChatCredentials): Promise<void> {
    credentials = next
    if (options.saveCredentials) {
      await options.saveCredentials(options.tokenPath, next)
    }
  }

  return {
    async hasCredentials() {
      const existing = await loadCredentials()
      return Boolean(existing?.token)
    },

    async login({ force = false, signal } = {}) {
      if (!force) {
        const existing = await loadCredentials()
        if (existing) {
          credentials = existing
          return existing
        }
      }

      const fetchFn = await resolveFetch()
      const qrResponse = await fetchFn(`${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`)
      if (!qrResponse.ok) {
        throw new Error(`WeChat QR fetch failed: HTTP ${qrResponse.status}`)
      }
      const qrData = (await qrResponse.json()) as { qrcode?: string; qrcode_img_content?: string }
      const qrcode = qrData.qrcode
      if (!qrcode) throw new Error('WeChat QR response missing qrcode')

      const qrUrl = qrData.qrcode_img_content || `weixin://qr/${qrcode}`
      options.onQrUrl?.(qrUrl)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (signal?.aborted || stopped) throw new Error('WeChat login aborted')
        const statusResponse = await fetchFn(
          `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
          { headers: { 'iLink-App-ClientVersion': '1' } }
        )
        if (!statusResponse.ok) {
          throw new Error(`WeChat QR status failed: HTTP ${statusResponse.status}`)
        }
        const status = (await statusResponse.json()) as {
          status?: string
          bot_token?: string
          ilink_bot_id?: string
          ilink_user_id?: string
          baseurl?: string
        }

        if (status.status === 'confirmed' && status.bot_token && status.ilink_user_id) {
          const next: WeChatCredentials = {
            token: status.bot_token,
            baseUrl: (status.baseurl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
            accountId: status.ilink_bot_id || '',
            userId: status.ilink_user_id
          }
          await saveCredentials(next)
          return next
        }

        if (status.status === 'expired') {
          options.onQrUrl?.(qrUrl)
          continue
        }

        // wait/scaned — tests inject confirmed credentials; production polls externally.
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      throw new Error('WeChat QR login timed out')
    },

    onMessage(handler) {
      inboundHandler = handler
    },

    async run() {
      const active = await loadCredentials()
      if (!active) throw new Error('WeChat credentials missing')
      credentials = active
      // Default protocol does not long-poll; inject a fuller protocol for live getupdates.
      // Keep the handler registered so hosts can still attach before an injected run loop.
      void inboundHandler
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    },

    stop() {
      stopped = true
    },

    async send(userId, text) {
      const active = credentials ?? (await loadCredentials())
      if (!active) throw new Error('WeChat bot is not connected')
      const fetchFn = await resolveFetch()
      const contextToken = contextTokens.get(userId) ?? ''
      const response = await fetchFn(`${active.baseUrl}/ilink/bot/sendmessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${active.token}`
        },
        body: JSON.stringify({
          msg: {
            to_user_id: userId,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text } }]
          }
        })
      })
      if (!response.ok) {
        throw new Error(`WeChat send failed: HTTP ${response.status}`)
      }
    },

    async sendTyping(userId) {
      const active = credentials ?? (await loadCredentials())
      if (!active) return
      const contextToken = contextTokens.get(userId)
      if (!contextToken) return
      const fetchFn = await resolveFetch()
      await fetchFn(`${active.baseUrl}/ilink/bot/sendtyping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${active.token}`
        },
        body: JSON.stringify({
          ilink_user_id: userId,
          status: 1
        })
      })
    }
  }
}

export function createInjectableWeChatProtocol(
  options: WeChatProtocolOptions & {
    onReady?: () => void
  } = { tokenPath: '/tmp/wechat.json' }
): WeChatProtocol & { deliver: (message: WeChatIncomingMessage) => Promise<void> } {
  let handler: ((message: WeChatIncomingMessage) => void | Promise<void>) | null = null
  const contextTokens = new Map<string, string>()
  let credentials = options.initialCredentials ?? null
  let stopped = false

  const protocol: WeChatProtocol & { deliver: (message: WeChatIncomingMessage) => Promise<void> } = {
    async hasCredentials() {
      return Boolean(credentials?.token || (await options.loadCredentials?.(options.tokenPath))?.token)
    },
    async login() {
      if (credentials) {
        options.onReady?.()
        return credentials
      }
      const qrUrl = 'https://example.test/wechat-qr'
      options.onQrUrl?.(qrUrl)
      credentials = {
        token: 'token',
        baseUrl: DEFAULT_BASE_URL,
        accountId: 'bot',
        userId: 'wx-user'
      }
      await options.saveCredentials?.(options.tokenPath, credentials)
      options.onReady?.()
      return credentials
    },
    onMessage(next) {
      handler = next
    },
    async run() {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    stop() {
      stopped = true
    },
    async send(userId, text) {
      void text
      contextTokens.set(userId, contextTokens.get(userId) ?? 'ctx')
    },
    async sendTyping() {
      // no-op for injectable protocol
    },
    async deliver(message) {
      contextTokens.set(message.userId, message.contextToken)
      await handler?.(message)
    }
  }

  return protocol
}
