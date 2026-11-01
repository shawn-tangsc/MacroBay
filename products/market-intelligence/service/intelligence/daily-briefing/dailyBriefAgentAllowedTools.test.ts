import { describe, expect, it } from 'vitest'

import { resolveDailyBriefAgentAllowedTools } from './dailyBriefAgentAllowedTools'

const base = {
  webSearchEnabled: true,
  authorized: true,
  providerReady: true,
  serverWebSearchSupported: false
}

describe('daily brief agent web-tool allowlist', () => {
  it('uses the built-in Anthropic tools on a first-party endpoint', () => {
    expect(resolveDailyBriefAgentAllowedTools({ ...base, serverWebSearchSupported: true }))
      .toEqual(['WebSearch', 'WebFetch'])
  })

  it('falls back to the platform web_search tool on third-party providers', () => {
    expect(resolveDailyBriefAgentAllowedTools(base)).toEqual(['web_search'])
  })

  it('grants nothing without both consent and a ready search provider', () => {
    expect(resolveDailyBriefAgentAllowedTools({ ...base, webSearchEnabled: false })).toBeUndefined()
    expect(resolveDailyBriefAgentAllowedTools({ ...base, authorized: false })).toBeUndefined()
    expect(resolveDailyBriefAgentAllowedTools({ ...base, providerReady: false })).toBeUndefined()
  })
})
