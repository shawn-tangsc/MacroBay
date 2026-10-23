import { describe, expect, it } from 'vitest'

import type { TaskRunLogEntity } from '../../schemas/taskSchemas'
import { countConsecutiveTerminalFailures } from './taskFailureCircuit'

function runLog(id: string, startedAt: string, status: TaskRunLogEntity['status']): TaskRunLogEntity {
  return { id, scheduleId: 'task-1', startedAt, durationMs: 1, status }
}

describe('countConsecutiveTerminalFailures', () => {
  it('uses the resume reset boundary consistently for dispatch and planning', () => {
    const logs = [
      runLog('failure-after-resume', '2026-01-01T10:31:00.000Z', 'failed'),
      runLog('failure-at-resume', '2026-01-01T10:30:00.000Z', 'failed'),
      runLog('failure-before-resume', '2026-01-01T10:29:00.000Z', 'failed')
    ]

    expect(countConsecutiveTerminalFailures(logs, '2026-01-01T10:30:00.000Z')).toBe(1)
  })
})
