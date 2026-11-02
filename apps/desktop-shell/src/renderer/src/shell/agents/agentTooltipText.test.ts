import { describe, expect, it } from 'vitest'

import { resolveAgentTooltipText } from './agentTooltipText'

import type { AgentText } from './agentText'

/** 只造解析器用得到的那几段，别把整棵 AgentText 手写一遍。 */
const text = {
  messages: {
    navigateTop: '回到顶部',
    navigatePrevious: '上一条消息'
  }
} as unknown as AgentText

describe('resolveAgentTooltipText', () => {
  it('resolves a lower-case dotted key onto the camel-cased object path', () => {
    expect(resolveAgentTooltipText(text, 'messages.navigate-top')).toBe('回到顶部')
    expect(resolveAgentTooltipText(text, 'messages.navigate-previous')).toBe('上一条消息')
  })

  it('returns an empty string for a key the text does not have', () => {
    // 空串是 `Tooltip` 不渲染提示的判据；退回键名会把 `messages.nope` 念给读者。
    expect(resolveAgentTooltipText(text, 'messages.nope')).toBe('')
    expect(resolveAgentTooltipText(text, 'messages.navigate-top.deeper')).toBe('')
  })
})
