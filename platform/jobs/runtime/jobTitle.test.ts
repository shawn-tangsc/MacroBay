import { describe, expect, it } from 'vitest'

import { resolveJobTitle } from './jobTitle'

describe('resolveJobTitle', () => {
  it('picks the language the reader is in, for a built-in job', () => {
    const title = { 'zh-CN': '采集美元指数', 'en-US': 'Collect the dollar index' }
    expect(resolveJobTitle(title, undefined, 'zh-CN')).toBe('采集美元指数')
    expect(resolveJobTitle(title, undefined, 'en-US')).toBe('Collect the dollar index')
  })

  it('never translates a title the reader wrote themselves', () => {
    // 读者自建任务：中文界面、英文界面都必须是同一句原文。
    const title = { literal: '每天九点总结行情' }
    expect(resolveJobTitle(title, undefined, 'zh-CN')).toBe('每天九点总结行情')
    expect(resolveJobTitle(title, undefined, 'en-US')).toBe('每天九点总结行情')
  })

  it('keeps word order in the copy table, not in code', () => {
    // 同一条作业：中文「采集 X」/ 英文「Collect X」——语序各写各的，不在渲染里拼。
    const title = { 'zh-CN': '采集 {name}', 'en-US': 'Collect {name}' }
    expect(resolveJobTitle(title, { name: '美元指数' }, 'zh-CN')).toBe('采集 美元指数')
    expect(resolveJobTitle(title, { name: '美元指数' }, 'en-US')).toBe('Collect 美元指数')
  })

  it('leaves a missing parameter empty instead of printing the placeholder', () => {
    const title = { 'zh-CN': '采集 {name}', 'en-US': 'Collect {name}' }
    expect(resolveJobTitle(title, {}, 'zh-CN')).toBe('采集 ')
    expect(resolveJobTitle(title, undefined, 'zh-CN')).toBe('采集 {name}')
  })

  it('still resolves the plain string the un-migrated registrations carry', () => {
    // 迁移窗口内的遗留形状：趁类型还没翻，存量注册点仍是英文句子。
    expect(resolveJobTitle('Prune daily brief sessions', undefined, 'zh-CN')).toBe('Prune daily brief sessions')
  })
})
