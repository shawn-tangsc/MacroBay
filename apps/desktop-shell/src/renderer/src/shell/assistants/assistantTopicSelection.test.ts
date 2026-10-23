import { describe, expect, it } from 'vitest'

import { selectTopicAfterDeletion } from './assistantTopicSelection'

describe('selectTopicAfterDeletion', () => {
  const topics = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('selects the following topic after the current topic is deleted', () => {
    expect(selectTopicAfterDeletion(topics, [{ id: 'a' }, { id: 'c' }], 'b')).toBe('c')
  })

  it('falls back to the preceding topic when the deleted topic was last', () => {
    expect(selectTopicAfterDeletion(topics, [{ id: 'a' }, { id: 'b' }], 'c')).toBe('b')
  })

  it('returns null when no topic remains', () => {
    expect(selectTopicAfterDeletion([{ id: 'a' }], [], 'a')).toBeNull()
  })
})
