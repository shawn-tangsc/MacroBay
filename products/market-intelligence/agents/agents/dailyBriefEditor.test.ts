import { describe, expect, it } from 'vitest'

import { createDailyBriefEditorAgentSeed } from './dailyBriefEditor'

describe('daily brief editor product seed', () => {
  it('runs the editor at low reasoning effort without dropping the other configuration', () => {
    const agent = createDailyBriefEditorAgentSeed().agents?.[0]

    expect(agent?.configuration).toMatchObject({
      effort: 'low',
      permission_mode: 'plan',
      max_turns: 8,
      heartbeat_enabled: false,
      productId: 'market-intelligence',
      dataAccessProfileId: 'crypto-market-analysis-v1',
      configProfileId: 'daily-brief-editor-v1',
      requireSessionToolAllowlist: true
    })
  })
})
