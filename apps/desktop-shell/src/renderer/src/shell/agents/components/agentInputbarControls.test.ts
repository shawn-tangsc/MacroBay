import { describe, expect, it } from 'vitest'

import { canSubmitAgentInput, getAgentTextareaMaxHeight, toggleAgentInputExpanded, shouldShowStopControl } from './agentInputbarControls'

describe('agent inputbar controls', () => {
  it('allows submitting a follow-up while a run is active when text exists', () => {
    expect(canSubmitAgentInput({ draft: 'Follow up', fileCount: 0 })).toBe(true)
  })

  it('allows submitting attachments without text', () => {
    expect(canSubmitAgentInput({ draft: '   ', fileCount: 1 })).toBe(true)
  })

  it('keeps empty input disabled', () => {
    expect(canSubmitAgentInput({ draft: '   ', fileCount: 0 })).toBe(false)
  })

  it('shows stop control only when a run id exists', () => {
    expect(shouldShowStopControl('run-1')).toBe(true)
    expect(shouldShowStopControl(null)).toBe(false)
  })

  it('uses a taller textarea limit in expanded mode', () => {
    expect(getAgentTextareaMaxHeight(false)).toBe(180)
    expect(getAgentTextareaMaxHeight(true)).toBe(420)
  })

  it('toggles expanded mode from current or explicit next state', () => {
    expect(toggleAgentInputExpanded(false)).toBe(true)
    expect(toggleAgentInputExpanded(true)).toBe(false)
    expect(toggleAgentInputExpanded(false, false)).toBe(false)
    expect(toggleAgentInputExpanded(false, true)).toBe(true)
  })
})
