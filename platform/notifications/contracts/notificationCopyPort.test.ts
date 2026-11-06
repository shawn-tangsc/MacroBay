/**
 * 文案解析端口（契约 §3.3 v2.40）：作业名走 `job-title` 这个 scope，**不另建文案表**。
 *
 * 这几条守的是「名字只有一个来源」：按 `definitionId` 去作业定义上取，解析那一刻按当前语言选；
 * 取不到就整句判为解析不到（调用方降级成兜底句），**绝不把 `definitionId` 或 `{taskName}` 印出去**。
 */
import { describe, expect, it } from 'vitest'

import { notificationCopy } from '../../i18n/notificationCopy'
import { createNotificationCopyPort } from './notificationCopyPort'

const titles: Readonly<Record<string, Record<'zh-CN' | 'en-US', string>>> = {
  'market-calendar.daily': {
    'zh-CN': '市场日历 · 经济数据',
    'en-US': 'Market calendar · economic data'
  }
}

function port(overrides: { jobTitle?: (id: string, language: 'zh-CN' | 'en-US') => string | null } = {}) {
  return createNotificationCopyPort({
    platform: notificationCopy,
    jobTitle: overrides.jobTitle ?? ((id, language) => titles[id]?.[language] ?? null)
  })
}

describe('作业名这个 scope', () => {
  it('按 definitionId 取作业定义上的名字，按解析时的语言选', () => {
    expect(port().resolve({ scope: 'job-title', definitionId: 'market-calendar.daily' }, 'zh-CN'))
      .toBe('市场日历 · 经济数据')
    expect(port().resolve({ scope: 'job-title', definitionId: 'market-calendar.daily' }, 'en-US'))
      .toBe('Market calendar · economic data')
  })

  it('定义不存在就是解析不到：返回 null，不返回 definitionId', () => {
    expect(port().resolve({ scope: 'job-title', definitionId: 'not-registered' }, 'zh-CN')).toBeNull()
  })

  it('没注入作业名来源时一律解析不到，不会退化成别的东西', () => {
    const withoutTitles = createNotificationCopyPort({ platform: notificationCopy })
    expect(withoutTitles.resolve({ scope: 'job-title', definitionId: 'market-calendar.daily' }, 'zh-CN'))
      .toBeNull()
  })

  it('里层取到空串算解析不到：空名字等于没说', () => {
    const blank = port({ jobTitle: () => '  ' })
    expect(blank.resolve({ scope: 'job-title', definitionId: 'market-calendar.daily' }, 'zh-CN')).toBeNull()
  })
})

describe('数字参数：读的那一刻按语言格式化（契约 v2.42 第三种）', () => {
  const key = 'notification.taskFailed.title'

  it('中文按亿/万，英文按 M/B；符号不进正文', () => {
    const params = { taskName: { number: -420_000_000, kind: 'usd' as const } }
    expect(port().resolve({ scope: 'platform', key, params }, 'zh-CN')).toBe('任务失败：4.2 亿美元')
    expect(port().resolve({ scope: 'platform', key, params }, 'en-US')).toBe('Task failed: $420M')
  })

  it('同一条记录切语言只换写法，数字与单位口径各自成立', () => {
    const pct = { taskName: { number: 2.3, kind: 'pct' as const } }
    const multiple = { taskName: { number: 3.1, kind: 'multiple' as const } }
    const count = { taskName: { number: 3, kind: 'count' as const } }

    expect(port().resolve({ scope: 'platform', key, params: pct }, 'zh-CN')).toBe('任务失败：2.3%')
    expect(port().resolve({ scope: 'platform', key, params: multiple }, 'zh-CN')).toBe('任务失败：3.1 倍')
    expect(port().resolve({ scope: 'platform', key, params: multiple }, 'en-US')).toBe('Task failed: 3.1×')
    // 整数不拖 `.0`，「连续 3 日」不该写成「3.0」。
    expect(port().resolve({ scope: 'platform', key, params: count }, 'zh-CN')).toBe('任务失败：3')
  })

  it('非法数值整句解析不到：不印 NaN，也不印半个单位', () => {
    const params = { taskName: { number: Number.NaN, kind: 'usd' as const } }
    expect(port().resolve({ scope: 'platform', key, params }, 'zh-CN')).toBeNull()
  })
})

describe('参数可以是引用（一层）', () => {
  const key = 'notification.event.platform.job.failed-terminal.title'

  it('{taskName} 传作业名引用：中英各读出各自的名字', () => {
    const params = { taskName: { ref: { scope: 'job-title' as const, definitionId: 'market-calendar.daily' } } }
    expect(port().resolve({ scope: 'platform', key, params }, 'zh-CN')).toBe('任务失败：市场日历 · 经济数据')
    expect(port().resolve({ scope: 'platform', key, params }, 'en-US'))
      .toBe('Task failed: Market calendar · economic data')
  })

  it('引用解析不到 → 整句判为解析不到，不把 {taskName} 印给读者', () => {
    const params = { taskName: { ref: { scope: 'job-title' as const, definitionId: 'gone' } } }
    expect(port().resolve({ scope: 'platform', key, params }, 'zh-CN')).toBeNull()
  })

  it('字面量参数照旧：日期、次数这类本来就与语言无关', () => {
    expect(port().resolve({ scope: 'platform', key, params: { taskName: '手动任务' } }, 'zh-CN'))
      .toBe('任务失败：手动任务')
  })

  it('缺参数仍是整句解析不到，不许印占位符', () => {
    expect(port().resolve({ scope: 'platform', key }, 'zh-CN')).toBeNull()
  })
})
