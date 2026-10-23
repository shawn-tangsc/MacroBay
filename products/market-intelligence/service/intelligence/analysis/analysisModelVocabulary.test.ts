import { describe, expect, it } from 'vitest'

// The renderer i18n registry is imported here on purpose: this is the one place the two
// vocabularies are compared, so a name added for the model cannot silently differ from the name
// the reader sees. Production code never crosses this boundary in either direction.
import { productText } from '../../../desktop/shared/i18n/productText'
import { analysisModelVocabulary, analysisVocabularyRequiredIds } from './analysisModelVocabulary'

const zh = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames
const en = productText['en-US'].pages.intelligence.portal.analysisWorkspace.readableNames

describe('analysis model vocabulary', () => {
  it('names every identifier the pipeline can hand the model', () => {
    for (const [kind, ids] of Object.entries(analysisVocabularyRequiredIds)) {
      for (const id of ids) {
        expect(analysisModelVocabulary[kind as keyof typeof analysisModelVocabulary][id], `${kind}:${id}`).toBeTruthy()
      }
    }
  })

  it('says the same thing as the reader-facing i18n registry', () => {
    for (const kind of Object.keys(analysisModelVocabulary) as (keyof typeof analysisModelVocabulary)[]) {
      const model = analysisModelVocabulary[kind]
      expect(Object.keys(zh[kind]).sort(), `${kind} (zh-CN)`).toEqual(Object.keys(model).sort())
      for (const [id, name] of Object.entries(model)) expect(zh[kind][id], `${kind}:${id}`).toBe(name)
    }
  })

  it('keeps the English names complete so no identifier falls back to a machine token', () => {
    for (const kind of Object.keys(analysisModelVocabulary) as (keyof typeof analysisModelVocabulary)[]) {
      expect(Object.keys(en[kind]).sort(), `${kind} (en-US)`).toEqual(Object.keys(analysisModelVocabulary[kind]).sort())
      for (const name of Object.values(en[kind])) expect(name.length).toBeGreaterThan(0)
    }
  })

  it('names exactly the identifiers a reader reported as unreadable', () => {
    expect(analysisModelVocabulary.metric['change-1d-usd']).toBe('1 日变化')
    expect(analysisModelVocabulary.metric['current-usd']).toBe('当前值')
    expect(analysisModelVocabulary.domain['cross-asset']).toBe('跨资产')
    expect(analysisModelVocabulary.term.consensus).toBe('市场预期值')
    expect(analysisModelVocabulary.subject.stablecoins).toBe('稳定币')
    expect(zh.metric['change-7d-usd']).toBe('7 日变化')
    expect(en.metric['change-7d-usd']).toBe('7 day change')
  })
})
