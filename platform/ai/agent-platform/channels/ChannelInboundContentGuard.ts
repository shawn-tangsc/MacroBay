import type { ChannelContentGuard } from './ChannelInboundContracts'
import { guardExternalContent } from './ExternalContentGuard'

/**
 * Adapters hand raw external text to the platform; this turns it into the guarded form that gets
 * persisted. Wrapping is unconditional (the agent must always see where text came from) and
 * rejection is deliberately narrow: only a forged boundary marker is a definite attempt to
 * impersonate the guard itself. Everything else is wrapped and flagged, never dropped.
 */
export function createChannelInboundContentGuard(deps: {
  channelTypeForChannel: (channelId: string) => string | null
}): ChannelContentGuard {
  return (facts) => {
    if (!facts.text) return { text: facts.text ?? null, rejection: null }

    const guarded = guardExternalContent(facts.text, {
      chatId: facts.providerConversationKey,
      userId: facts.providerUserKey,
      userName: facts.providerUserLabel ?? facts.providerUserKey,
      channelType: deps.channelTypeForChannel(facts.channelId) ?? 'external'
    })

    return {
      text: guarded.wrappedText,
      rejection: guarded.suspiciousPatternNames.includes('fake-boundary') ? 'channel-content-rejected' : null
    }
  }
}
