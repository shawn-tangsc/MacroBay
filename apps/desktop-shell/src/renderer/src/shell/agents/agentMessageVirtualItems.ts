import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { ChatSettings } from '@platform/settings/schema/appSettings'

import type { AgentMessageGroup } from '@platform/ui/agent-chat'
import type { AgentMessageVirtualItem } from './agentMessageVirtualWindow'
import { buildAgentMessageFileArtifacts } from './agentMessageFileArtifacts'

export function buildAgentMessageVirtualItems(
  groups: readonly AgentMessageGroup[],
  chatSettings: Pick<ChatSettings, 'fontSize' | 'messageStyle' | 'narrowMode'> | null,
  cachedHeightsByProfile: Record<string, number> = {}
): AgentMessageVirtualItem[] {
  return groups.map((group) => {
    const profile = buildAgentMessageVirtualHeightProfile(group, chatSettings)
    return {
      id: group.id,
      messageCount: group.messages.length,
      estimatedHeight: cachedHeightsByProfile[profile] ?? estimateAgentMessageGroupHeight(group, chatSettings)
    }
  })
}

export function buildAgentMessageVirtualHeightCache(
  groups: readonly AgentMessageGroup[],
  measuredHeightsById: Record<string, number>,
  chatSettings: Pick<ChatSettings, 'fontSize' | 'messageStyle' | 'narrowMode'> | null
): Record<string, number> {
  const totals = new Map<string, { sum: number; count: number }>()

  for (const group of groups) {
    const measuredHeight = measuredHeightsById[group.id]
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) continue

    const profile = buildAgentMessageVirtualHeightProfile(group, chatSettings)
    const current = totals.get(profile)
    if (current) {
      current.sum += measuredHeight
      current.count += 1
      continue
    }
    totals.set(profile, {
      sum: measuredHeight,
      count: 1
    })
  }

  return Object.fromEntries(
    [...totals.entries()].map(([profile, value]) => [profile, Math.round(value.sum / value.count)])
  )
}

function estimateAgentMessageGroupHeight(
  group: AgentMessageGroup,
  chatSettings: Pick<ChatSettings, 'fontSize' | 'messageStyle' | 'narrowMode'> | null
): number {
  const fontSize = chatSettings?.fontSize ?? 14
  const lineHeight = Math.max(18, Math.round(fontSize * 1.68))
  const charsPerLine = chatSettings?.narrowMode ? 42 : 68
  const bubblePadding = chatSettings?.messageStyle === 'bubble' ? 20 : 0
  const messageGap = 8
  const groupChrome = 44

  const total = group.messages.reduce((sum, message, index) => {
    return sum + estimateAgentMessageHeight(message, { lineHeight, charsPerLine, bubblePadding }) + (index > 0 ? messageGap : 0)
  }, groupChrome)

  return Math.max(88, total)
}

function buildAgentMessageVirtualHeightProfile(
  group: AgentMessageGroup,
  chatSettings: Pick<ChatSettings, 'fontSize' | 'messageStyle' | 'narrowMode'> | null
): string {
  const fontBucket = Math.max(12, Math.round((chatSettings?.fontSize ?? 14) / 2) * 2)
  const messageCountBucket = Math.min(4, Math.max(1, group.messages.length))
  const role = group.role
  const style = chatSettings?.messageStyle ?? 'plain'
  const narrow = chatSettings?.narrowMode === true ? 'narrow' : 'wide'
  const textBucket = Math.min(12, Math.max(1, Math.ceil(countGroupTextCharacters(group) / 120)))
  const runtimeBucket = Math.min(5, countGroupRuntimeBlocks(group))
  const fallbackBucket = Math.min(4, countGroupFallbackBlocks(group))
  const errorDetailBucket = Math.min(6, countGroupRuntimeErrorLines(group))
  const attachmentBucket = Math.min(6, countGroupAttachmentBlocks(group))
  const structuredBucket = Math.min(6, countGroupStructuredResultWeight(group))
  const fileArtifactBucket = Math.min(6, countGroupFileArtifactRows(group))

  return [
    role,
    style,
    narrow,
    `font:${fontBucket}`,
    `messages:${messageCountBucket}`,
    `text:${textBucket}`,
    `runtime:${runtimeBucket}`,
    `fallback:${fallbackBucket}`,
    `error:${errorDetailBucket}`,
    `attachments:${attachmentBucket}`,
    `structured:${structuredBucket}`,
    `files:${fileArtifactBucket}`
  ].join('|')
}

function estimateAgentMessageHeight(
  message: AgentSessionMessageEntity,
  input: {
    lineHeight: number
    charsPerLine: number
    bubblePadding: number
  }
): number {
  const textChars = countTextCharacters(message)
  const runtimeBlocks = countRuntimeBlocks(message)
  const openRuntimeDetailLines = countOpenRuntimeDetailLines(message, input.charsPerLine)
  const fallbackBlocks = countFallbackBlocks(message)
  const attachmentBlocks = countAttachmentBlocks(message)
  const structuredResultWeight = countStructuredResultWeight(message)
  const fileArtifactRows = countFileArtifactRows(message)

  let height = 28

  if (textChars > 0) {
    height += estimateTextHeight(textChars, input.charsPerLine, input.lineHeight) + input.bubblePadding
  }

  if (runtimeBlocks > 0) {
    height += runtimeBlocks * 42
  }

  if (openRuntimeDetailLines > 0) {
    height += 18 + openRuntimeDetailLines * 17
  }

  if (fallbackBlocks > 0) {
    height += fallbackBlocks * (input.lineHeight + 10)
  }

  if (attachmentBlocks > 0) {
    height += attachmentBlocks * 86
  }

  if (structuredResultWeight > 0) {
    height += structuredResultWeight * 18
  }

  if (fileArtifactRows > 0) {
    height += 74 + Math.min(6, fileArtifactRows) * 58
  }

  return height
}

function countTextCharacters(message: AgentSessionMessageEntity): number {
  const partChars = message.data.parts.reduce((sum, part) => {
    if (part.type !== 'text' || typeof part.text !== 'string') return sum
    return sum + part.text.trim().length
  }, 0)

  if (partChars > 0) return partChars
  return message.searchableText.trim().length
}

function countGroupTextCharacters(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countTextCharacters(message), 0)
}

function countRuntimeBlocks(message: AgentSessionMessageEntity): number {
  return message.data.parts.reduce((sum, part) => {
    return isVisibleRuntimePart(part) ? sum + 1 : sum
  }, 0)
}

function countGroupRuntimeBlocks(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countRuntimeBlocks(message), 0)
}

function countFallbackBlocks(message: AgentSessionMessageEntity): number {
  return message.data.parts.reduce((sum, part) => {
    if (part.type === 'text' || part.type === 'agent-mentioned-models') return sum
    return isRuntimePartType(part.type) ? sum : sum + 1
  }, 0)
}

function countGroupFallbackBlocks(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countFallbackBlocks(message), 0)
}

function countOpenRuntimeDetailLines(message: AgentSessionMessageEntity, charsPerLine: number): number {
  return message.data.parts.reduce((sum, part) => {
    if (part.type !== 'claude-sdk-tool-result' || part.isError !== true) return sum

    const errorText = typeof part.errorText === 'string' ? part.errorText.trim() : ''
    if (!errorText) return sum + 2
    return sum + estimateLineCount(errorText, charsPerLine)
  }, 0)
}

function countGroupRuntimeErrorLines(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countOpenRuntimeDetailLines(message, 60), 0)
}

function countAttachmentBlocks(message: AgentSessionMessageEntity): number {
  return message.data.parts.reduce((sum, part) => {
    if (part.type !== 'claude-sdk-tool-result') return sum
    return sum + countToolResultContentAttachments(part.content)
  }, 0)
}

function countGroupAttachmentBlocks(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countAttachmentBlocks(message), 0)
}

function countStructuredResultWeight(message: AgentSessionMessageEntity): number {
  return message.data.parts.reduce((sum, part) => {
    if (part.type !== 'claude-sdk-tool-result') return sum
    return sum + estimateStructuredValueWeight(part.structuredContent) + estimateStructuredValueWeight(part.output)
  }, 0)
}

function countGroupStructuredResultWeight(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countStructuredResultWeight(message), 0)
}

function countFileArtifactRows(message: AgentSessionMessageEntity): number {
  return buildAgentMessageFileArtifacts(message.data.parts).totalCount
}

function countGroupFileArtifactRows(group: AgentMessageGroup): number {
  return group.messages.reduce((sum, message) => sum + countFileArtifactRows(message), 0)
}

function countToolResultContentAttachments(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.reduce((sum, block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return sum
    const record = block as Record<string, unknown>
    return record.type === 'image' || record.type === 'resource' ? sum + 1 : sum
  }, 0)
}

function estimateStructuredValueWeight(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return Math.min(6, Math.ceil(value.trim().length / 160))
  if (typeof value === 'number' || typeof value === 'boolean') return 1
  if (Array.isArray(value)) return Math.min(6, Math.max(1, value.length))
  if (typeof value === 'object') return Math.min(6, Math.max(1, Object.keys(value as Record<string, unknown>).length))
  return 0
}

function estimateTextHeight(textChars: number, charsPerLine: number, lineHeight: number): number {
  return Math.max(1, Math.ceil(Math.max(1, textChars) / Math.max(16, charsPerLine))) * lineHeight
}

function estimateLineCount(text: string, charsPerLine: number): number {
  const normalized = text.trim()
  if (!normalized) return 1

  return normalized.split(/\r?\n/).reduce((sum, line) => {
    const effectiveLength = Math.max(1, line.trim().length)
    return sum + Math.max(1, Math.ceil(effectiveLength / Math.max(16, charsPerLine)))
  }, 0)
}

function isRuntimePartType(type: string): boolean {
  return (
    type === 'claude-sdk-reasoning' ||
    type === 'claude-sdk-tool-call' ||
    type === 'claude-sdk-tool-result' ||
    type === 'claude-sdk-runtime-control'
  )
}

function isVisibleRuntimePart(part: AgentSessionMessageEntity['data']['parts'][number]): boolean {
  if (!isRuntimePartType(part.type)) return false
  if (part.type !== 'claude-sdk-runtime-control') return true

  const subtype = typeof part.subtype === 'string' ? part.subtype : ''
  const hasMessage = typeof part.message === 'string' && part.message.trim().length > 0
  return hasMessage || (subtype !== 'thinking_tokens' && subtype !== 'compact_boundary')
}
