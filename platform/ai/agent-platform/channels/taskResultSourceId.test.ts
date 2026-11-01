import { describe, expect, it } from 'vitest'

import { parseTaskResultSourceId, taskResultOutcomes, taskResultSourceId } from './taskResultSourceId'

describe('task result source id', () => {
  it('round-trips every outcome', () => {
    for (const outcome of taskResultOutcomes) {
      expect(parseTaskResultSourceId(taskResultSourceId('run-1', outcome))).toEqual({
        runLogId: 'run-1',
        outcome
      })
    }
  })

  // The format must not require run ids to avoid colons: the outcome is the last segment.
  it('round-trips a run id that contains colons', () => {
    const runLogId = 'task:2026-11-01:run:001'

    expect(parseTaskResultSourceId(taskResultSourceId(runLogId, 'failed'))).toEqual({
      runLogId,
      outcome: 'failed'
    })
  })

  it('rejects anything that is not a task result source id', () => {
    // inbound replies carry a dispatch id and must never be read as a task result.
    expect(parseTaskResultSourceId('dispatch-1')).toBeNull()
    expect(parseTaskResultSourceId('run-1:sending')).toBeNull()
    expect(parseTaskResultSourceId('run-1:')).toBeNull()
    expect(parseTaskResultSourceId(':completed')).toBeNull()
  })
})
