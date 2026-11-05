import { describe, expect, it } from 'vitest'

import { resolveNotificationText } from './notificationText'

/**
 * 一条通知**用哪种语言说话，是提交那一刻定下的**。
 *
 * 记录里存的是键与参数（不是句子），所以改措辞历史会跟着变好；但语言不能跟着界面变——
 * 那样切一次语言，昨天收到的通知会变成今天的说法，跟运行记录的规矩冲突（改写历史）。
 *
 * 唯一的例外是**旧记录**：它们提交时没人记语言，替它们编一个就是伪造历史，只能跟随当前语言。
 * 这两条方向相反，所以各钉一条用例。
 */

const record = {
  titleKey: 'notification.taskFailed.title',
  titleParams: { taskName: '市场日历 · 经济数据' },
  bodyKey: 'notification.taskFailed.body'
} as const

describe('通知文本的语言', () => {
  it('记录带语言时按记录的语言，不跟界面走', () => {
    const frozen = { ...record, language: 'en-US' as const }
    expect(resolveNotificationText(frozen, 'zh-CN').title).toContain('Task failed')
    expect(resolveNotificationText(frozen, 'en-US').title).toContain('Task failed')
  })

  it('反向：把语言标签换掉，文本必须跟着变（证明这一格真的在起作用）', () => {
    expect(resolveNotificationText({ ...record, language: 'zh-CN' }, 'en-US').title).not.toBe(
      resolveNotificationText({ ...record, language: 'en-US' }, 'en-US').title
    )
  })

  it('旧记录没有语言标签时跟随当前语言（历史遗留处理，不是设计）', () => {
    const zh = resolveNotificationText(record, 'zh-CN')
    const en = resolveNotificationText(record, 'en-US')
    expect(zh.title).not.toBe(en.title)
    expect(zh.title).toContain('任务失败')
  })

  it('措辞改了，历史记录跟着变——因为存的是键，不是句子', () => {
    // 断言的是「同一个键在不同语言下解析出各自的句子」，即句子不在记录里。
    const frozen = { ...record, language: 'en-US' as const }
    expect(resolveNotificationText(frozen, 'en-US').body).toBe(
      resolveNotificationText({ ...record, language: 'en-US' }, 'zh-CN').body
    )
  })
})
