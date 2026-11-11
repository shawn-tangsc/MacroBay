import { describe, expect, it } from 'vitest'

import { intelligenceSourcesText } from '../../../desktop/shared/i18n/text/settings/intelligenceSources'
import { allSources } from './providerRegistry'

/**
 * 每个源一句人话（产品 2026-11-10 定稿，`c3-source-summaries-2026-11-10.md`）。
 *
 * **句式只有一份**：类型里只有 `summaryKey`，没有 `summary` 字段——句子在这里不可能被塞进注册表。
 * 下面三条是第一道的补充，都断在「以后有人改坏」的那个方向上：
 * 1. 键必须是**从 sourceId 派生**的那一个（手写 39 个键，错一个字符读者看到的就是裸键名）；
 * 2. 中英两份都要非空（只接了一侧，另一侧语言下就是空行）；
 * 3. 注册表**数据**里不许出现中日韩字符（注释不算——本文件满是中文注释，扫全文必红且红得没意义）。
 *
 * 第 3 条挡不住「有人把英文句子写进注册表」，所以提交说明里不许把它说成「保证句子只有一份」；
 * 真正挡住的是类型：`SourceDefinition` 里只有 `summaryKey`。
 */

const KEY_PREFIX = 'settings.intelligenceSources.sourceSummary.'

/** 中日韩统一表意文字 + 兼容表意 + 假名 + 谚文：句子进注册表时至少会命中其中一类。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u

type SummaryTable = Record<string, string>

function summaryTable(locale: 'zh-CN' | 'en-US'): SummaryTable {
  const table = (intelligenceSourcesText[locale] as unknown as { sourceSummary?: SummaryTable }).sourceSummary
  return table ?? {}
}

function stringsIn(value: unknown, path: string, out: Array<{ field: string; text: string }>): void {
  if (typeof value === 'string') {
    out.push({ field: path, text: value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => stringsIn(entry, `${path}[${index}]`, out))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) stringsIn(entry, `${path}.${key}`, out)
  }
}

describe('every source carries the key to its own one-line summary', () => {
  it('derives the key from the sourceId instead of trusting a hand-typed one', () => {
    const wrong = allSources()
      .filter((source) => source.summaryKey !== KEY_PREFIX + source.sourceId)
      .map((source) => `${source.sourceId} → ${source.summaryKey ?? '(none)'}`)
    expect(wrong).toEqual([])
  })

  it('has a non-empty sentence on both locales for every source', () => {
    const tables = { zh: summaryTable('zh-CN'), en: summaryTable('en-US') }
    const missing: string[] = []
    for (const source of allSources()) {
      const suffix = source.summaryKey?.slice(KEY_PREFIX.length)
      if (suffix === undefined) {
        missing.push(`${source.sourceId}: no summaryKey`)
        continue
      }
      if ((tables.zh[suffix] ?? '').trim() === '') missing.push(`${source.sourceId}: zh`)
      if ((tables.en[suffix] ?? '').trim() === '') missing.push(`${source.sourceId}: en`)
      // 句子是给读者的一句话：换行会把它变成两段。
      if (/[\r\n]/u.test(tables.zh[suffix] ?? '')) missing.push(`${source.sourceId}: zh newline`)
      if (/[\r\n]/u.test(tables.en[suffix] ?? '')) missing.push(`${source.sourceId}: en newline`)
    }
    expect(missing).toEqual([])
  })

  it('carries no sentence for a source the registry does not have', () => {
    // 反向：文案表里多出来的键，说明句子属于一个已经不在注册表里的源——它永远不会被画出来，
    // 下一个人照着它找源会找空。两个方向都判，这份表才不会变成第二个「源清单」。
    const registered = new Set(allSources().map((source) => source.summaryKey))
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const extra = Object.keys(summaryTable(locale))
        .filter((sourceId) => !registered.has(KEY_PREFIX + sourceId))
        .map((sourceId) => `${locale}:${sourceId}`)
      expect(extra).toEqual([])
    }
  })

  it('keeps prose out of the registry: no CJK in any source field', () => {
    const offenders: string[] = []
    for (const source of allSources()) {
      const strings: Array<{ field: string; text: string }> = []
      stringsIn(source, source.sourceId, strings)
      for (const entry of strings) if (CJK.test(entry.text)) offenders.push(entry.field)
    }
    expect(offenders).toEqual([])
  })
})
