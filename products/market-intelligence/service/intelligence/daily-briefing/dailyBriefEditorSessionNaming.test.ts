import { describe, expect, it } from 'vitest'
import { dailyBriefEditionKey, dailyBriefSessionCopy, dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'

const CJK = /[\u4e00-\u9fff]/

describe('daily brief session naming', () => {
  it('puts date, task, locale and optional topic in the title', () => {
    expect(dailyBriefSessionTitle({ date: '2026-10-30', locale: 'zh-CN' })).toBe('10-30 每日简报 · AI 编辑 · 中文')
    expect(dailyBriefSessionTitle({ date: '2026-11-06', locale: 'zh-CN', topic: '非农前夜' })).toBe('11-06 每日简报 · 非农前夜 · AI 编辑 · 中文')
    expect(dailyBriefSessionTitle({ date: '2026-10-30', locale: 'en-US' })).toBe('10-30 Daily brief · AI editor · EN')
    expect(dailyBriefSessionTitle({ date: '2026-11-06', locale: 'en-US', topic: 'Nonfarm eve' })).toBe('11-06 Daily brief · Nonfarm eve · AI editor · EN')
    expect(dailyBriefEditionKey('2026-10-30', 'zh-CN')).toBe('2026-10-30:zh-CN')
  })

  it('writes the visible session copy in the edition language', () => {
    const en = dailyBriefSessionCopy('en-US')
    for (const value of [en.startTask, en.firstTask, en.factsLabel, en.empty, en.missing, en.unknownRequest]) {
      expect(value).not.toMatch(CJK)
    }
    expect(en.startTask).toContain('{date}')
    const zh = dailyBriefSessionCopy('zh-CN')
    expect(zh.startTask).toContain('每日简报')
    expect(zh.firstTask).toContain('任务 1/2')
  })
})
