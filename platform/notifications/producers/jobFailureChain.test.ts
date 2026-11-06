import { describe, expect, it } from 'vitest'

import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import { countConsecutiveTerminalFailures } from './jobFailureChain'

function run(status: JobRunRecord['status'], id: string): JobRunRecord {
  return {
    id,
    definitionId: 'definition-1',
    handlerId: 'handler-1',
    owner: 'platform',
    title: 'Collect 央行',
    status,
    trigger: { kind: 'manual' },
    payload: {},
    attempt: 1,
    maxAttempts: 1,
    createdAt: '2026-11-02T01:00:00.000Z',
    logs: []
  }
}

describe('consecutive terminal failures', () => {
  it('counts a trailing run of failed runs, newest first', () => {
    expect(
      countConsecutiveTerminalFailures([run('failed', 'r3'), run('failed', 'r2'), run('failed', 'r1')])
    ).toBe(3)
  })

  it('stops at the first success: consecutive means nothing succeeded in between', () => {
    expect(
      countConsecutiveTerminalFailures([
        run('failed', 'r4'),
        run('failed', 'r3'),
        run('completed', 'r2'),
        run('failed', 'r1')
      ])
    ).toBe(2)
  })

  it('skips cancelled runs instead of counting them as success or failure', () => {
    // 用户主动取消不是任务出错，也不该把「连续」打断。
    expect(
      countConsecutiveTerminalFailures([
        run('failed', 'r4'),
        run('cancelled', 'r3'),
        run('failed', 'r2'),
        run('failed', 'r1')
      ])
    ).toBe(3)
  })

  it('ignores runs that have not settled yet', () => {
    expect(
      countConsecutiveTerminalFailures([run('running', 'r3'), run('failed', 'r2'), run('failed', 'r1')])
    ).toBe(2)
    expect(countConsecutiveTerminalFailures([run('queued', 'r1')])).toBe(0)
  })

  it('answers zero when there is no history to count', () => {
    expect(countConsecutiveTerminalFailures([])).toBe(0)
  })
})
