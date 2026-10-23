import { describe, expect, it } from 'vitest'

import { buildAgentSessionAutoTitle, shouldAutoRenameAgentSession } from './agentSessionAutoTitle'

describe('agent session auto title', () => {
  it('builds a compact title from the first user request', () => {
    expect(
      buildAgentSessionAutoTitle('Please review this pull request and identify the riskiest regression paths before I merge it.')
    ).toBe('Please review this pull request and identify')
  })

  it('normalizes punctuation and whitespace before truncating', () => {
    expect(buildAgentSessionAutoTitle('  # Plan:   fix login\n\n- reproduce\n- add regression test  ')).toBe(
      'Plan fix login reproduce add regression test'
    )
  })

  it('only auto-renames default empty-looking session names', () => {
    expect(shouldAutoRenameAgentSession('New agent session')).toBe(true)
    expect(shouldAutoRenameAgentSession('新的智能体会话')).toBe(true)
    expect(shouldAutoRenameAgentSession('Session')).toBe(true)
    expect(shouldAutoRenameAgentSession('Manually named session')).toBe(false)
  })
})
