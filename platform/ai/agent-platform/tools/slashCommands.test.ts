import { describe, expect, it } from 'vitest'

import { getBuiltinSlashCommands } from './slashCommands'

describe('agent slash commands', () => {
  it('matches the Claude Code built-in slash command surface', () => {
    expect(getBuiltinSlashCommands('claude-code').map((item) => item.command)).toEqual([
      '/clear',
      '/compact',
      '/context',
      '/cost',
      '/todos'
    ])
  })

  it('does not expose custom commands for unknown agent types', () => {
    expect(getBuiltinSlashCommands('unknown')).toEqual([])
  })
})
