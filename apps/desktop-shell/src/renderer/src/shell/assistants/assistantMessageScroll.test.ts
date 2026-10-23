import { describe, expect, it } from 'vitest'

import {
  isAssistantMessageListNearBottom,
  scrollAssistantMessageListAfterRender,
  updateAssistantMessageListStickiness
} from './assistantMessageScroll'

describe('assistantMessageScroll', () => {
  it('keeps the message list pinned to the newest content when already near the bottom', () => {
    const state = { shouldStickToBottom: true }
    const element = {
      scrollTop: 380,
      clientHeight: 420,
      scrollHeight: 840
    }

    updateAssistantMessageListStickiness(element, state)
    element.scrollHeight = 1160
    scrollAssistantMessageListAfterRender(element, state)

    expect(element.scrollTop).toBe(740)
  })

  it('does not pull the viewport down after the user scrolls up to read older messages', () => {
    const state = { shouldStickToBottom: true }
    const element = {
      scrollTop: 120,
      clientHeight: 420,
      scrollHeight: 980
    }

    updateAssistantMessageListStickiness(element, state)
    element.scrollHeight = 1320
    scrollAssistantMessageListAfterRender(element, state)

    expect(element.scrollTop).toBe(120)
  })

  it('resumes following new content after the user returns near the bottom', () => {
    const state = { shouldStickToBottom: false }
    const element = {
      scrollTop: 535,
      clientHeight: 420,
      scrollHeight: 980
    }

    expect(isAssistantMessageListNearBottom(element)).toBe(true)
    updateAssistantMessageListStickiness(element, state)
    element.scrollHeight = 1240
    scrollAssistantMessageListAfterRender(element, state)

    expect(element.scrollTop).toBe(820)
  })
})
