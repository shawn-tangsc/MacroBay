import { describe, expect, it } from 'vitest'

import { resolveAgentTooltipText, type AgentTooltipKey } from './agentTooltipText'

import type { AgentText } from './agentText'

/** 只造解析器用得到的那几段，别把整棵 AgentText 手写一遍。 */
const text = {
  messages: {
    navigateTop: '回到顶部',
    navigatePrevious: '上一条消息'
  }
} as unknown as AgentText

describe('resolveAgentTooltipText', () => {
  it('resolves the real text path, camelCase included', () => {
    expect(resolveAgentTooltipText(text, 'messages.navigateTop')).toBe('回到顶部')
    expect(resolveAgentTooltipText(text, 'messages.navigatePrevious')).toBe('上一条消息')
  })

  it('keeps the key set closed at the type level, not just at runtime', () => {
    // 这一条是**编译期**断言，不是运行时断言：键现在是一组联合，
    // 闭集之外的键在 `tsc` 阶段就红，不需要等有人手误把提示写成空气泡。
    // @ts-expect-error 闭集之外的键必须编译不过
    const outsideTheSet: AgentTooltipKey = 'messages.nope'
    expect(outsideTheSet).toBe('messages.nope')
  })

  it('returns an empty string for a path the text does not have', () => {
    // 空串是 `Tooltip` 不渲染提示的判据；退回键名会把 `messages.nope` 念给读者。
    // 闭集之外的两条走不到（上面那条已经拦住），这里只用强制转换留一条运行期兜底：
    // 文本对象缺一段时仍然返回空串，绝不把键名念出去。
    expect(resolveAgentTooltipText(text, 'messages.navigate-top.deeper' as AgentTooltipKey)).toBe('')
  })
})
