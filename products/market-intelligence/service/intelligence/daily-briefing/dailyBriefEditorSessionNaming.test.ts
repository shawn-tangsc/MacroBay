import { describe, expect, it } from 'vitest'
import { dailyBriefEditionKey, dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'

describe('daily brief session naming', () => {
  it('puts date, task, locale and optional topic in the title', () => {
    expect(dailyBriefSessionTitle({ date: '2026-10-30', locale: 'zh-CN' })).toBe('10-30 每日简报 · AI 编辑 · 中文')
    expect(dailyBriefSessionTitle({ date: '2026-11-06', locale: 'en-US', topic: '非农前夜' })).toBe('11-06 每日简报 · 非农前夜 · AI 编辑 · EN')
    expect(dailyBriefEditionKey('2026-10-30', 'zh-CN')).toBe('2026-10-30:zh-CN')
  })
})
