import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { editorialNotice, editorialNoticeCase } from './dailyBriefingEditorialNotice'

const zh = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const en = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing

describe('the editorial notice picks one of three cases from the code, never from prose', () => {
  it('sends a missing model to "configure"', () => {
    for (const code of ['model-unavailable', 'model-not-ready', 'provider-disabled', 'missing-api-key']) {
      expect(editorialNoticeCase(code)).toBe('no-model')
      const notice = editorialNotice(code, zh)!
      expect(notice.sentence).toContain('配好模型后重新生成')
      expect(notice.action).toBe('configure')
    }
  })

  it('sends a failed write to "regenerate" with a human reason, never the code', () => {
    expect(editorialNoticeCase('rate-limited')).toBe('model-failed')
    const notice = editorialNotice('provider-error', zh)!
    expect(notice.sentence).toContain('模型服务返回了错误')
    expect(notice.sentence).not.toContain('provider-error')
    expect(notice.action).toBe('regenerate')
  })

  it('recognises the platform balance code and offers no button — waiting is the only action', () => {
    expect(editorialNoticeCase('provider-account-balance-insufficient')).toBe('quota')
    const notice = editorialNotice('provider-account-balance-insufficient', zh)!
    expect(notice.sentence).toContain('额度')
    expect(notice.action).toBeUndefined()
    // 没拿到恢复时刻就不编一个：句子只说"额度恢复后"。
    expect(notice.sentence).not.toMatch(/\d{1,2}[:：]\d{2}/)
  })

  it('says nothing when the reader turned AI editing off, and speaks both languages', () => {
    expect(editorialNotice('editorial-disabled', zh)).toBeUndefined()
    expect(editorialNotice(undefined, zh)).toBeUndefined()
    expect(editorialNotice('model-unavailable', en)!.sentence).toContain('No model is configured')
    expect(editorialNotice('provider-account-balance-insufficient', en)!.sentence).toContain('quota')
    // 三种情形的话必须互不相同（r17 `A2`）。
    const sentences = ['model-unavailable', 'provider-error', 'provider-account-balance-insufficient']
      .map((code) => editorialNotice(code, zh)!.sentence)
    expect(new Set(sentences).size).toBe(3)
  })
})
