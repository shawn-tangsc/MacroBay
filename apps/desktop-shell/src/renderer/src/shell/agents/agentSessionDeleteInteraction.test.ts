import { describe, expect, it } from 'vitest'

import { getSessionDeleteClickIntent } from './agentSessionDeleteInteraction'

describe('agent session delete interaction', () => {
  it('asks for inline confirmation on the first regular delete click', () => {
    expect(getSessionDeleteClickIntent({ confirming: false, modifierPressed: false })).toBe('confirm')
  })

  it('deletes after the row is already confirming', () => {
    expect(getSessionDeleteClickIntent({ confirming: true, modifierPressed: false })).toBe('delete')
  })

  it('deletes immediately when the platform modifier key is pressed', () => {
    expect(getSessionDeleteClickIntent({ confirming: false, modifierPressed: true })).toBe('delete')
  })
})
