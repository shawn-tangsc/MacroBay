import { describe, expect, it } from 'vitest'

import { getScrollTopAfterPrepend, isNearBottom } from './agentMessageScroll'

describe('agentMessageScroll', () => {
  it('treats small remaining distance as near-bottom', () => {
    expect(
      isNearBottom({
        scrollTop: 540,
        clientHeight: 420,
        scrollHeight: 990
      })
    ).toBe(true)
  })

  it('does not treat large remaining distance as near-bottom', () => {
    expect(
      isNearBottom({
        scrollTop: 320,
        clientHeight: 420,
        scrollHeight: 990
      })
    ).toBe(false)
  })

  it('preserves viewport position after older messages are prepended', () => {
    expect(
      getScrollTopAfterPrepend({
        previousScrollTop: 280,
        previousScrollHeight: 1200,
        nextScrollHeight: 1680
      })
    ).toBe(760)
  })
})
