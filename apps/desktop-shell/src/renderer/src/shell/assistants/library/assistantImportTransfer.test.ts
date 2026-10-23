import { describe, expect, it } from 'vitest'

import { parseAssistantImportJson } from './assistantImportTransfer'

describe('assistantImportTransfer', () => {
  it('parses assistant records', () => {
    const result = parseAssistantImportJson(
      JSON.stringify([
        {
          name: 'Writer',
          emoji: '✍️',
          prompt: 'Write clearly.',
          description: 'Draft and revise.',
          group: ['Writing']
        }
      ])
    )

    expect(result).toEqual([
      {
        name: 'Writer',
        icon: '✍️',
        prompt: 'Write clearly.',
        description: 'Draft and revise.',
        tags: [{ id: 'writing', name: 'Writing' }]
      }
    ])
  })

  it('rejects records without name or prompt', () => {
    expect(() => parseAssistantImportJson('[{"name":"Broken"}]')).toThrow(/prompt/)
  })
})
