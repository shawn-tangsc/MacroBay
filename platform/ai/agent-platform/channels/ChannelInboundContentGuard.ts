import type { ChannelContentGuard } from './ChannelInboundContracts'
import { guardExternalContent } from './ExternalContentGuard'

/**
 * Adapters hand raw external text to the platform; this turns it into the guarded form that gets
 * persisted. Wrapping is unconditional (the agent must always see where text came from). Whether a
 * payload is rejected is the guard's decision, not this adapter's: the policy belongs with the
 * provenance, so a fourth entry point cannot invent a fifth rule.
 */
export function createChannelInboundContentGuard(deps: {
  channelTypeForChannel: (channelId: string) => string | null
}): ChannelContentGuard {
  return (facts) => {
    if (!facts.text) return { text: facts.text ?? null, rejection: null }

    const guarded = guardExternalContent(facts.text, {
      kind: 'channel',
      chatId: facts.providerConversationKey,
      userId: facts.providerUserKey,
      userName: facts.providerUserLabel ?? facts.providerUserKey,
      channelType: deps.channelTypeForChannel(facts.channelId) ?? 'external'
    })

    return {
      text: guarded.guardedText,
      rejection: guarded.disposition === 'reject' ? 'channel-content-rejected' : null
    }
  }
}
