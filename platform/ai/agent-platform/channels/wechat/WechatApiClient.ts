import type { WechatProviderConversation } from './WechatContracts'

/** Typed injected-only seam. Release F never invokes it because the public iLink protocol is unfrozen. */
export class WechatApiClient {
  constructor(private readonly _deps: { getPlatformFetch: () => typeof fetch; context: () => Promise<string | null> }) {}

  async sendText(_conversation: WechatProviderConversation, _text: string, _signal?: AbortSignal): Promise<'unknown'> {
    return 'unknown'
  }
}
