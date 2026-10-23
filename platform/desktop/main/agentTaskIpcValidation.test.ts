import { describe, expect, it } from 'vitest'

import {
  AgentTaskIpcValidationError,
  parseTaskAutomationPolicyUpdate,
  parseTaskAuditQuery,
  parseTaskCreateDto,
  parseTaskId,
  parseTaskListQuery,
  parseTaskPageQuery,
  parseOffsetPage,
  parseTaskRevisionRequest,
  parseTaskSchedulePreview,
  parseTaskUpdateRequest
} from './agentTaskIpcValidation'

describe('agent task IPC validation', () => {
  const options = { now: new Date('2026-07-16T00:00:00.000Z'), defaultTimezone: 'Asia/Shanghai' }

  it('requires an explicit finite snapshot revision for mutations', () => {
    expect(parseTaskRevisionRequest({ expectedRevision: 2 })).toEqual({ expectedRevision: 2 })
    for (const expectedRevision of [undefined, 0, -1, 1.1, Number.NaN, Infinity]) {
      expect(() => parseTaskRevisionRequest({ expectedRevision })).toThrow(AgentTaskIpcValidationError)
    }
  })

  it('uses the shared schedule validator for timezone-aware preview and update DTOs', () => {
    expect(parseTaskSchedulePreview({ trigger: { kind: 'cron', expr: '0 9 * * *' } }, options)).toEqual({
      kind: 'cron',
      expr: '0 9 * * *'
    })
    expect(() => parseTaskSchedulePreview({ trigger: { kind: 'cron', expr: 'invalid', timezone: 'Bad/Timezone' } }, options)).toThrow(
      AgentTaskIpcValidationError
    )
    expect(parseTaskUpdateRequest({ expectedRevision: 2, patch: { trigger: { kind: 'interval', ms: 300_000 } } }, options)).toEqual({
      expectedRevision: 2,
      patch: { trigger: { kind: 'interval', ms: 300_000 } }
    })
  })

  it('rejects unbounded or fractional offset pages instead of forwarding them', () => {
    expect(parseOffsetPage({ limit: 100, offset: 0 })).toEqual({ limit: 100, offset: 0 })
    expect(() => parseOffsetPage({ limit: 101 })).toThrow(AgentTaskIpcValidationError)
    expect(() => parseOffsetPage({ limit: 10.5 })).toThrow(AgentTaskIpcValidationError)
    expect(() => parseOffsetPage({ offset: -1 })).toThrow(AgentTaskIpcValidationError)
  })

  it('bounds task DTO collections and field-specific integer limits before service execution', () => {
    const base = { name: 'Task', prompt: 'Run', trigger: { kind: 'interval', ms: 300_000 }, workspace: { type: 'system' } }
    expect(parseTaskCreateDto({ ...base, channelIds: Array.from({ length: 10 }, (_, i) => `channel-${i}`) }, options).channelIds).toHaveLength(10)
    for (const channelIds of [Array.from({ length: 11 }, (_, i) => `channel-${i}`), ['same', 'same'], ['x'.repeat(161)], Array.from({ length: 1001 }, (_, i) => `id-${i}`)]) expect(() => parseTaskCreateDto({ ...base, channelIds }, options)).toThrow(AgentTaskIpcValidationError)
    expect(parseTaskRevisionRequest({ expectedRevision: 2_147_483_647 })).toEqual({ expectedRevision: 2_147_483_647 })
    for (const expectedRevision of [2_147_483_648, Number.MAX_SAFE_INTEGER]) expect(() => parseTaskRevisionRequest({ expectedRevision })).toThrow(AgentTaskIpcValidationError)
    expect(parseTaskCreateDto({ ...base, timeoutMinutes: 120, catchUpPolicy: { kind: 'after-startup', minutes: 44_640 } }, options)).toMatchObject({ timeoutMinutes: 120 })
    for (const input of [{ timeoutMinutes: 121 }, { catchUpPolicy: { kind: 'after-startup', minutes: 44_641 } }, { trigger: { kind: 'cron', expr: '0 9 * * *', limit: 1_000_001 } }, { trigger: { kind: 'interval', ms: 31 * 24 * 60 * 60 * 1000 + 1 } }, { trigger: { kind: 'once', at: 8_640_000_000_000_001 } }]) expect(() => parseTaskCreateDto({ ...base, ...input }, options)).toThrow(AgentTaskIpcValidationError)
  })

  it('accepts only repository-shaped task cursors and rejects malformed page/query inputs', () => {
    const cursor = Buffer.from(JSON.stringify({ nextRun: null, createdAt: '2026-07-17T00:00:00.000Z', id: 'task-1' })).toString('base64url')
    expect(parseTaskPageQuery({ cursor })).toMatchObject({ cursor })
    for (const value of ['nope', Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ nextRun: 'bad', createdAt: 'bad', id: '' })).toString('base64url'), Buffer.from(JSON.stringify({ nextRun: null, createdAt: '2026-01-01T00:00:00.000Z', id: 'x'.repeat(161) })).toString('base64url')]) expect(() => parseTaskPageQuery({ cursor: value })).toThrow(AgentTaskIpcValidationError)
    for (const value of ['', 'x'.repeat(161), 1]) expect(() => parseTaskId(value)).toThrow(AgentTaskIpcValidationError)
    for (const query of [{}, { taskId: 'task', agentId: 'agent' }]) expect(() => parseTaskAuditQuery(query)).toThrow(AgentTaskIpcValidationError)
    expect(() => parseTaskAutomationPolicyUpdate({ policyPreset: 'unsafe' })).toThrow(AgentTaskIpcValidationError)
    expect(() => parseTaskPageQuery({ status: 'unknown', limit: 101, offset: -1 })).toThrow(AgentTaskIpcValidationError)
    expect(() => parseTaskListQuery({ includeHeartbeat: 'yes' })).toThrow(AgentTaskIpcValidationError)
  })
})
