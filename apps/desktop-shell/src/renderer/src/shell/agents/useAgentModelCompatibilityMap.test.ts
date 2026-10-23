import { describe, expect, it } from 'vitest'

import { selectCompatibilityProbeTarget } from './useAgentModelCompatibilityMap'

const candidates = [
  { key: 'provider-a:model-1' },
  { key: 'provider-a:model-2' },
  { key: 'provider-b:model-3' }
]

describe('selectCompatibilityProbeTarget', () => {
  it('only revalidates the model the composer would send', () => {
    expect(selectCompatibilityProbeTarget(candidates, 'provider-a:model-2')).toEqual({
      key: 'provider-a:model-2'
    })
  })

  it('does not fan out when no model is selected', () => {
    expect(selectCompatibilityProbeTarget(candidates, null)).toBeNull()
    expect(selectCompatibilityProbeTarget(candidates, '')).toBeNull()
  })

  it('returns null when the selected key is not a runtime candidate', () => {
    expect(selectCompatibilityProbeTarget(candidates, 'provider-c:model-9')).toBeNull()
  })
})
