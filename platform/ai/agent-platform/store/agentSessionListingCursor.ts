import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import {
  AGENT_SESSION_MESSAGES_DEFAULT_LIMIT as DEFAULT_MESSAGE_PAGE_LIMIT,
  AGENT_SESSION_MESSAGES_MAX_LIMIT as MAX_MESSAGE_PAGE_LIMIT
} from '../schemas/sessionSchemas'

import type { AgentSessionPin } from './agentStore'

/**
 * Session and message ordering: the comparator, the cursor it encodes, and the page limit.
 *
 * These are the rules that decide what "the next page" means — reading the cursor, comparing by
 * order key or pin, and falling back to the id so two rows written in the same millisecond still
 * have one stable order. They are here rather than in the store so the store keeps the state
 * transitions, and a change to paging is checked against the cursor alone.
 */
export function normalizeMessagePageLimit(limit: number | undefined): number {
  return normalizePageLimit(limit, DEFAULT_MESSAGE_PAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT)
}

export function normalizePageLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (!Number.isFinite(limit) || limit === undefined) return defaultLimit
  return Math.min(Math.max(Math.trunc(limit), 1), maxLimit)
}

export function sortSessionsByOrderKey(a: AgentSessionEntity, b: AgentSessionEntity): number {
  const order = (a.orderKey ?? '').localeCompare(b.orderKey ?? '')
  return order === 0 ? a.id.localeCompare(b.id) : order
}

export function compareSessionListOrder(
  a: AgentSessionEntity,
  b: AgentSessionEntity,
  pins: readonly AgentSessionPin[]
): number {
  const pinIndex = new Map(pins.map((pin, index) => [pin.sessionId, index]))
  const aPin = pinIndex.get(a.id)
  const bPin = pinIndex.get(b.id)
  if (aPin !== undefined || bPin !== undefined) {
    if (aPin === undefined) return 1
    if (bPin === undefined) return -1
    return aPin - bPin
  }
  return sortSessionsByOrderKey(a, b)
}

export function sessionCursorSortKey(session: AgentSessionEntity, pins: readonly AgentSessionPin[]): string {
  const pinIndex = pins.findIndex((pin) => pin.sessionId === session.id)
  if (pinIndex >= 0) return `pin:${String(pinIndex).padStart(6, '0')}`
  return session.orderKey ?? ''
}

export function isSessionAfterCursor(
  session: AgentSessionEntity,
  cursor: { kind: 'pin'; pinIndex: number; id: string } | { kind: 'session'; orderKey: string; id: string },
  pins: readonly AgentSessionPin[]
): boolean {
  const pinIndex = pins.findIndex((pin) => pin.sessionId === session.id)
  if (cursor.kind === 'pin') {
    if (pinIndex >= 0) {
      return pinIndex > cursor.pinIndex || (pinIndex === cursor.pinIndex && session.id > cursor.id)
    }
    return true
  }

  if (pinIndex >= 0) {
    return false
  }
  const order = (session.orderKey ?? '').localeCompare(cursor.orderKey)
  return order > 0 || (order === 0 && session.id > cursor.id)
}

export function encodeSessionCursor(session: AgentSessionEntity, pins: readonly AgentSessionPin[]): string {
  return `${sessionCursorSortKey(session, pins)}:${session.id}`
}

export function decodeSessionCursor(raw: string):
  | { kind: 'pin'; pinIndex: number; id: string }
  | { kind: 'session'; orderKey: string; id: string }
  | null {
  const separatorIndex = raw.lastIndexOf(':')
  if (separatorIndex < 0 || separatorIndex === raw.length - 1) return null

  const key = raw.slice(0, separatorIndex)
  const id = raw.slice(separatorIndex + 1)
  if (!key || !id) return null
  if (key.startsWith('pin:')) {
    const pinIndex = Number(key.slice('pin:'.length))
    return Number.isFinite(pinIndex) ? { kind: 'pin', pinIndex, id } : null
  }
  return { kind: 'session', orderKey: key, id }
}

export function sortMessagesNewestFirst(a: AgentSessionMessageEntity, b: AgentSessionMessageEntity): number {
  const createdAtOrder = messageCreatedAtMs(b) - messageCreatedAtMs(a)
  return createdAtOrder === 0 ? b.id.localeCompare(a.id) : createdAtOrder
}

export function isMessageOlderThanCursor(
  message: AgentSessionMessageEntity,
  cursor: { createdAt: number; id: string }
): boolean {
  const createdAt = messageCreatedAtMs(message)
  return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && message.id < cursor.id)
}

export function encodeMessageCursor(message: AgentSessionMessageEntity): string {
  return `${messageCreatedAtMs(message)}:${message.id}`
}

export function decodeMessageCursor(raw: string): { createdAt: number; id: string } | null {
  const separatorIndex = raw.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null

  const createdAt = Number(raw.slice(0, separatorIndex))
  const id = raw.slice(separatorIndex + 1)
  if (!Number.isFinite(createdAt) || !id) return null
  return { createdAt, id }
}

export function messageCreatedAtMs(message: AgentSessionMessageEntity): number {
  const createdAt = Date.parse(message.createdAt)
  return Number.isFinite(createdAt) ? createdAt : 0
}

export function createOrderKey(timestamp: string, index: number): string {
  return `${timestamp}-${String(index).padStart(4, '0')}`
}

export function createFirstOrderKey(sessions: readonly AgentSessionEntity[]): string {
  const smallest = sessions[0]?.orderKey
  return smallest ? `0-${Date.now().toString(36)}-${smallest}` : '0'
}
