import { describe, expect, it } from 'vitest'

import { buildTodosCommandResult } from './buildTodosCommandResult'

describe('buildTodosCommandResult', () => {
  it('returns a stable empty result when no todos exist', () => {
    expect(buildTodosCommandResult()).toEqual({
      type: 'todos',
      summary: 'No runtime todos are available.',
      todos: []
    })
  })

  it('lists provided runtime todos', () => {
    const result = buildTodosCommandResult({
      todos: [{ id: '1', label: 'Inspect logs', status: 'in_progress' }]
    })

    expect(result.summary).toContain('1')
    expect(result.todos).toHaveLength(1)
  })
})
