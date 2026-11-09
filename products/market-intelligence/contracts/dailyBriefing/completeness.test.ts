import { describe, expect, it } from 'vitest'

import { briefingCompleteness } from './completeness'

describe('briefing completeness', () => {
  it('calls a single-language edition that published complete, so nothing is written', () => {
    expect(briefingCompleteness({ publishedLocales: ['zh-CN'], readingsAvailable: 4, readingsTotal: 4 }))
      .toEqual({ state: 'complete' })
  })

  it('names a missing version only when the run expected more than it published', () => {
    expect(briefingCompleteness({ expectedLocales: ['zh-CN', 'en-US'], publishedLocales: ['zh-CN'], readingsAvailable: 4, readingsTotal: 4 }))
      .toEqual({ state: 'missing-version' })
    expect(briefingCompleteness({ expectedLocales: ['zh-CN', 'en-US'], publishedLocales: ['zh-CN', 'en-US'], readingsAvailable: 4, readingsTotal: 4 }))
      .toEqual({ state: 'complete' })
  })

  it('counts missing readings only once the versions are whole', () => {
    expect(briefingCompleteness({ expectedLocales: ['zh-CN'], publishedLocales: ['zh-CN'], readingsAvailable: 2, readingsTotal: 4 }))
      .toEqual({ state: 'missing-readings', count: 2 })
  })
})

describe('a headline with no edition-language translation is marked as the original', () => {
  it('marks an English headline in a Chinese edition instead of printing it silently', async () => {
    const { editionNewsTitle, editionNewsTitleIsOriginal } = await import('./readings')
    const item = { title: 'Bitcoin steadies after AI-led selloff' }
    expect(editionNewsTitle(item, 'zh-CN')).toBe(item.title)
    // 没有汉字、也没有本期译文 → 它是原文，页面与复制文本都要标出来。
    expect(editionNewsTitleIsOriginal(item, 'zh-CN')).toBe(true)
  })

  it('does not mark a headline that was translated into the edition language', async () => {
    const { editionNewsTitleIsOriginal } = await import('./readings')
    expect(editionNewsTitleIsOriginal({ title: 'Bitcoin steadies', translatedTitle: '比特币走稳' }, 'zh-CN')).toBe(false)
    // 英文版里的中文标题也只能印原文，同样要标。
    expect(editionNewsTitleIsOriginal({ title: '比特币走稳' }, 'en-US')).toBe(true)
  })
})
