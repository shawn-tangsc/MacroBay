import { describe, expect, it } from 'vitest'

import { agentText } from './agentText'

describe('agent text', () => {
  it('keeps Chinese and English dictionaries structurally aligned', () => {
    expect(flattenKeys(agentText['en-US'])).toEqual(flattenKeys(agentText['zh-CN']))
  })
})

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix]
  return Object.entries(value)
    .flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort()
}
