import { describe, expect, it } from 'vitest'

import { decidePublish } from './dailyBriefPublishDecision'

/**
 * One question, one function. Four outcomes, one test each — the reader's rule is that a brief is
 * only withheld when there is nothing to read, so these four cases are the whole policy.
 */
const base = { factsUsable: true, canceled: false, modelState: 'available' as const, validationFailures: 0 }

describe('decidePublish', () => {
  it('publishes when the facts are there, the model ran and nothing failed validation', () => {
    expect(decidePublish(base)).toBe('publish')
  })

  it('publishes the fact layer with gaps when no model is available', () => {
    // Not a failure: the quotes, the flows and the calendar are still there to read. Deciding
    // otherwise is what left readers with no brief all day because a model was not configured.
    expect(decidePublish({ ...base, modelState: 'unavailable' })).toBe('publish-with-gaps')
  })

  it('publishes the written version with gaps when validation never passed', () => {
    // The 2026-11-04 case: the body was written, one field was written in a shape the validator did
    // not accept, and the whole day had no brief. It should have been this.
    expect(decidePublish({ ...base, validationFailures: 3 })).toBe('publish-with-gaps')
  })

  it('fails only when not one usable fact exists', () => {
    expect(decidePublish({ ...base, factsUsable: false })).toBe('fail')
  })

  it('treats a cancelled run as its own outcome, not an error', () => {
    // Cancelling returns the pane to what it looked like before the click; it must not render a
    // failure panel over an edition that is still perfectly readable.
    expect(decidePublish({ ...base, canceled: true, factsUsable: false })).toBe('canceled')
    expect(decidePublish({ ...base, canceled: true })).toBe('canceled')
  })

  it('holds the order: cancellation outranks a missing fact set, which outranks gaps', () => {
    expect(decidePublish({ factsUsable: false, canceled: true, modelState: 'unavailable', validationFailures: 5 })).toBe('canceled')
    expect(decidePublish({ factsUsable: false, canceled: false, modelState: 'unavailable', validationFailures: 5 })).toBe('fail')
    expect(decidePublish({ factsUsable: true, canceled: false, modelState: 'available', validationFailures: 1 })).toBe('publish-with-gaps')
  })
})
