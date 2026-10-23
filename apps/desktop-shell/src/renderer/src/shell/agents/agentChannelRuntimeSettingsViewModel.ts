import type {
  AgentChannelRuntimeSnapshot,
  AgentChannelRuntimeSnapshotEntry,
  AgentChannelRuntimeState
} from '@platform/ai/agent-platform/channels/ChannelRuntimeService'
import type { AgentChannelEntity } from '@platform/ai/agent-platform/schemas/channelSchemas'

import type { AgentText } from './agentText'

type SettingsChannelRuntimeText = AgentText['settingsDrawer']['channelRuntime']
type SessionChannelRuntimeText = AgentText['sessionItem']['channelRuntime']

export type AgentChannelRuntimeSettingCard = {
  channelId: string
  channelName: string
  channelType: AgentChannelEntity['type']
  runtimeTone: AgentChannelRuntimeState
  runtimeLabel: string
  lifecycleLabel?: string
  credentialLabel?: string
  sessionLabel?: string
  runtimeMessage?: string
  credentialHint?: string
  credentialUrl?: string
  credentialQrText?: string
  activeChatsLabel: string
  updatedAtLabel: string
  expiresAtLabel?: string
  lastCheckedAtLabel?: string
}

export function buildSessionChannelRuntimeSettingCards(input: {
  sessionId: string
  channels: readonly AgentChannelEntity[]
  snapshot: AgentChannelRuntimeSnapshot
  runtimeText: SessionChannelRuntimeText
  settingsText: SettingsChannelRuntimeText
}): AgentChannelRuntimeSettingCard[] {
  const snapshotEntryByChannelId = new Map(
    input.snapshot.channels.map((entry) => [entry.channelId, entry] as const)
  )

  return input.channels
    .filter((channel) => channel.sessionId === input.sessionId)
    .map((channel) => {
      const entry = snapshotEntryByChannelId.get(channel.id)
      const updatedAtMs = resolveUpdatedAtMs(channel, entry)
      return {
        updatedAtMs,
        card: buildSettingCard(
          channel,
          entry,
          updatedAtMs,
          input.runtimeText,
          input.settingsText
        )
      }
    })
    .sort(compareSettingCards)
    .map((item) => item.card)
}

function buildSettingCard(
  channel: AgentChannelEntity,
  entry: AgentChannelRuntimeSnapshotEntry | undefined,
  updatedAtMs: number,
  runtimeText: SessionChannelRuntimeText,
  settingsText: SettingsChannelRuntimeText
): AgentChannelRuntimeSettingCard {
  const runtimeTone = entry?.runtimeState ?? (channel.isActive ? 'connecting' : 'inactive')

  return {
    channelId: channel.id,
    channelName: channel.name,
    channelType: channel.type,
    runtimeTone,
    runtimeLabel: runtimeText.status[runtimeTone],
    ...(entry?.runtimeLifecycleState
      ? { lifecycleLabel: runtimeText.lifecycleState[entry.runtimeLifecycleState] }
      : {}),
    ...(entry?.credentialState
      ? { credentialLabel: runtimeText.credentialState[entry.credentialState] }
      : {}),
    ...(entry?.sessionState ? { sessionLabel: runtimeText.sessionState[entry.sessionState] } : {}),
    ...(entry?.runtimeMessage ? { runtimeMessage: entry.runtimeMessage } : {}),
    ...(entry?.credentialHint ? { credentialHint: entry.credentialHint } : {}),
    ...(entry?.credentialUrl ? { credentialUrl: entry.credentialUrl } : {}),
    ...(entry?.credentialQrText ? { credentialQrText: entry.credentialQrText } : {}),
    activeChatsLabel: settingsText.activeChats(entry?.activeChatCount ?? channel.activeChatIds?.length ?? 0),
    updatedAtLabel: settingsText.updatedAt(new Date(updatedAtMs).toISOString()),
    ...(typeof entry?.credentialExpiresAt === 'number'
      ? { expiresAtLabel: runtimeText.expiresAt(new Date(entry.credentialExpiresAt).toISOString()) }
      : {}),
    ...(typeof entry?.lastCheckedAt === 'number'
      ? { lastCheckedAtLabel: runtimeText.lastCheckedAt(new Date(entry.lastCheckedAt).toISOString()) }
      : {})
  }
}

function compareSettingCards(
  left: { updatedAtMs: number; card: AgentChannelRuntimeSettingCard },
  right: { updatedAtMs: number; card: AgentChannelRuntimeSettingCard }
): number {
  const leftRank = getRuntimePriority(left.card.runtimeTone)
  const rightRank = getRuntimePriority(right.card.runtimeTone)
  if (leftRank !== rightRank) {
    return rightRank - leftRank
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return right.updatedAtMs - left.updatedAtMs
  }
  return left.card.channelName.localeCompare(right.card.channelName)
}

function getRuntimePriority(runtimeTone: AgentChannelRuntimeState): number {
  switch (runtimeTone) {
    case 'error':
      return 3
    case 'connecting':
      return 2
    case 'connected':
      return 1
    case 'inactive':
      return 0
    default:
      return 0
  }
}

function resolveUpdatedAtMs(
  channel: AgentChannelEntity,
  entry: AgentChannelRuntimeSnapshotEntry | undefined
): number {
  if (entry) return entry.updatedAt
  const fallbackMs = Date.parse(channel.updatedAt)
  return Number.isFinite(fallbackMs) ? fallbackMs : 0
}
