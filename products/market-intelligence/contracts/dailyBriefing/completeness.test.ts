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
