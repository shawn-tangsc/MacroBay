import { afterEach, describe, expect, it } from 'vitest'

import { registerTestNoticeCandidates, readTestNoticeCandidates, resetTestNoticeCandidatesForTests } from './testNoticeCandidatesSlot'

/** 判据：注册一次、只许一次、没注册就读不到（调用方据此回 `read-failed`）。 */
describe('test notice candidates slot', () => {
  afterEach(() => resetTestNoticeCandidatesForTests())

  it('reads nothing until a product registers, so the button keeps answering read-failed', () => {
    expect(readTestNoticeCandidates()).toBeUndefined()
  })

  it('hands the registered port back', () => {
    const port = async () => ({ ok: false as const, reasonCode: 'read-failed' as const })
    registerTestNoticeCandidates(port)
    expect(readTestNoticeCandidates()).toBe(port)
  })

  it('refuses a second registration instead of silently replacing the first', () => {
    const first = async () => ({ ok: false as const, reasonCode: 'read-failed' as const })
    const second = async () => ({ ok: false as const, reasonCode: 'read-failed' as const })
    registerTestNoticeCandidates(first)
    expect(() => registerTestNoticeCandidates(second)).toThrow('notification-test-candidates-already-registered')
    // 第一个仍然是它：不许「谁后注册谁生效」。
    expect(readTestNoticeCandidates()).toBe(first)
  })
})
