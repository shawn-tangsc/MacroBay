import { describe, expect, it } from 'vitest'

import { isSendShortcut } from './chatSendShortcut'

type KeyInit = {
  key?: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  isComposing?: boolean
}

/** 只喂判定真正读的字段：键、四个修饰键、输入法组合状态。 */
function keyEvent(init: KeyInit = {}): Parameters<typeof isSendShortcut>[0] {
  const event = {
    key: init.key ?? 'Enter',
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    nativeEvent: { isComposing: init.isComposing ?? false }
  }
  return event as unknown as Parameters<typeof isSendShortcut>[0]
}

describe('isSendShortcut', () => {
  it('sends on a bare Enter when the setting is "enter", and never with a modifier held', () => {
    expect(isSendShortcut(keyEvent(), 'enter')).toBe(true)
    expect(isSendShortcut(keyEvent({ shiftKey: true }), 'enter')).toBe(false)
    expect(isSendShortcut(keyEvent({ metaKey: true }), 'enter')).toBe(false)
    expect(isSendShortcut(keyEvent({ ctrlKey: true }), 'enter')).toBe(false)
    expect(isSendShortcut(keyEvent({ altKey: true }), 'enter')).toBe(false)
  })

  it('sends only with the platform modifier when the setting is "mod-enter"', () => {
    expect(isSendShortcut(keyEvent({ metaKey: true }), 'mod-enter')).toBe(true)
    expect(isSendShortcut(keyEvent({ ctrlKey: true }), 'mod-enter')).toBe(true)
    expect(isSendShortcut(keyEvent(), 'mod-enter')).toBe(false)
  })

  it('never sends while the input method is composing, whatever the setting', () => {
    expect(isSendShortcut(keyEvent({ isComposing: true }), 'enter')).toBe(false)
    expect(isSendShortcut(keyEvent({ isComposing: true, metaKey: true }), 'mod-enter')).toBe(false)
  })

  it('only looks at Enter', () => {
    expect(isSendShortcut(keyEvent({ key: 'a' }), 'enter')).toBe(false)
    expect(isSendShortcut(keyEvent({ key: 'a', metaKey: true }), 'mod-enter')).toBe(false)
  })

  it('gives the two settings different answers for the same keystroke', () => {
    // 同一次裸 Enter：`enter` 发、`mod-enter` 不发。若两档判据被抄成一份错误的实现，这条会红。
    expect(isSendShortcut(keyEvent(), 'enter')).toBe(true)
    expect(isSendShortcut(keyEvent(), 'mod-enter')).toBe(false)
  })
})
