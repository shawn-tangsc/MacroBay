import type { AgentChannelRuntimeSnapshot, AgentChannelRuntimeSnapshotEntry } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentChannelEntity } from '@platform/ai/agent-platform/schemas/channelSchemas'

import type { AgentText } from './agentText'

type SessionChannelRuntimeText = AgentText['sessionItem']['channelRuntime']

export type AgentSessionChannelRuntimeBadge = {
  channelId: string
  channelType: AgentChannelEntity['type']
  tone: AgentChannelRuntimeSnapshotEntry['runtimeState']
  label: string
  tooltipLines: string[]
}

export function buildSessionChannelRuntimeBadgeBySessionId(
  snapshot: AgentChannelRuntimeSnapshot,
  text: SessionChannelRuntimeText
): Record<string, AgentSessionChannelRuntimeBadge> {
  const selectedBySessionId = new Map<
    string,
    {
      entry: AgentChannelRuntimeSnapshotEntry
      badge: AgentSessionChannelRuntimeBadge
    }
  >()

  for (const entry of snapshot.channels) {
    if (!entry.isActive || !entry.sessionId) continue

    const badge = buildSessionChannelRuntimeBadge(entry, text)
    const selected = selectedBySessionId.get(entry.sessionId)
    if (!selected || shouldPreferChannelRuntimeEntry(entry, selected.entry)) {
      selectedBySessionId.set(entry.sessionId, {
        entry,
        badge
      })
    }
  }

  return Object.fromEntries(
    [...selectedBySessionId.entries()].map(([sessionId, selected]) => [sessionId, selected.badge])
  )
}

function buildSessionChannelRuntimeBadge(
  entry: AgentChannelRuntimeSnapshotEntry,
  text: SessionChannelRuntimeText
): AgentSessionChannelRuntimeBadge {
  const label = text.status[entry.runtimeState]
  const tooltipLines = [`${text.title}: ${label}`]

  if (entry.runtimeLifecycleState) {
    tooltipLines.push(`${text.lifecycle}: ${text.lifecycleState[entry.runtimeLifecycleState]}`)
  }
  if (entry.credentialState) {
    tooltipLines.push(`${text.credential}: ${text.credentialState[entry.credentialState]}`)
  }
  if (entry.sessionState) {
    tooltipLines.push(`${text.session}: ${text.sessionState[entry.sessionState]}`)
  }
  if (entry.credentialHint) {
    tooltipLines.push(`${text.hint}: ${entry.credentialHint}`)
  }
  if (entry.runtimeMessage) {
    tooltipLines.push(`${text.message}: ${entry.runtimeMessage}`)
  }
  if (typeof entry.runtimeRetryable === 'boolean') {
    tooltipLines.push(`${text.retry}: ${entry.runtimeRetryable ? text.retryable : text.notRetryable}`)
  }
  if (entry.credentialUrl) {
    tooltipLines.push(`${text.url}: ${entry.credentialUrl}`)
  }
  if (entry.credentialQrText) {
    tooltipLines.push(`${text.qr}: ${entry.credentialQrText}`)
  }
  if (typeof entry.credentialExpiresAt === 'number') {
    tooltipLines.push(text.expiresAt(new Date(entry.credentialExpiresAt).toISOString()))
  }
  if (typeof entry.lastCheckedAt === 'number') {
    tooltipLines.push(text.lastCheckedAt(new Date(entry.lastCheckedAt).toISOString()))
  }

  return {
    channelId: entry.channelId,
    channelType: entry.type,
    tone: entry.runtimeState,
    label,
    tooltipLines
  }
}

function shouldPreferChannelRuntimeEntry(
  nextEntry: AgentChannelRuntimeSnapshotEntry,
  currentEntry: AgentChannelRuntimeSnapshotEntry
): boolean {
  const nextRank = getChannelRuntimePriority(nextEntry)
  const currentRank = getChannelRuntimePriority(currentEntry)
  if (nextRank !== currentRank) {
    return nextRank > currentRank
  }
  if (nextEntry.updatedAt !== currentEntry.updatedAt) {
    return nextEntry.updatedAt > currentEntry.updatedAt
  }
  return nextEntry.channelId.localeCompare(currentEntry.channelId) < 0
}

function getChannelRuntimePriority(entry: AgentChannelRuntimeSnapshotEntry): number {
  switch (entry.runtimeState) {
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
