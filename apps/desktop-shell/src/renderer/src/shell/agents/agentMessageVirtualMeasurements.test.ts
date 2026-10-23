import { describe, expect, it } from 'vitest'

import { updateAgentMessageVirtualHeights } from './agentMessageVirtualMeasurements'

describe('agent message virtual measurements', () => {
  it('returns the same object when nothing changes', () => {
    const current = {
      'group-1': 120,
      'group-2': 180
    }

    expect(
      updateAgentMessageVirtualHeights({
        currentHeights: current,
        validIds: ['group-1', 'group-2'],
        nextHeightsById: {
          'group-1': 120,
          'group-2': 180
        }
      })
    ).toBe(current)
  })

  it('updates changed heights and prunes stale ids', () => {
    expect(
      updateAgentMessageVirtualHeights({
        currentHeights: {
          'group-1': 120,
          'group-2': 180,
          stale: 90
        },
        validIds: ['group-1', 'group-2', 'group-3'],
        nextHeightsById: {
          'group-2': 210,
          'group-3': 160
        }
      })
    ).toEqual({
      'group-1': 120,
      'group-2': 210,
      'group-3': 160
    })
  })

  it('ignores invalid height updates', () => {
    expect(
      updateAgentMessageVirtualHeights({
        currentHeights: {
          'group-1': 120
        },
        validIds: ['group-1', 'group-2', 'group-3', 'group-4'],
        nextHeightsById: {
          'group-2': 0,
          'group-3': Number.NaN,
          'group-4': -50
        }
      })
    ).toEqual({
      'group-1': 120
    })
  })
})
