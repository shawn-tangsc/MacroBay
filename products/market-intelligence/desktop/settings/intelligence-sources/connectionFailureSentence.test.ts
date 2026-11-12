import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { credentialVerificationLine } from './connectionFailureSentence'

/**
 * The one line the reader sees for the CryptoETF source. Four states, always visible, and no claim
 * this build cannot back: the "last verified at" sentence was retired because `lastValidatedAt`
 * falls back to the key's save time after a restart — it would show "verified" for a key nobody ever
 * tested.
 */

type Language = keyof typeof productText

function resolveTextIn(language: Language): (key: string) => string {
  return (key) => {
    const value = key.split('.').reduce<unknown>(
      (node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      productText[language]
    )
    return typeof value === 'string' ? value : ''
  }
}

const zh = resolveTextIn('zh-CN')
const en = resolveTextIn('en-US')

function line(overrides: Partial<Parameters<typeof credentialVerificationLine>[0]> = {}) {
  return credentialVerificationLine({
    notice: 'verification-only',
    resolveText: zh,
    hasCredential: true,
    feedback: undefined,
    ...overrides
  })
}

describe('the verification-only status line', () => {
  it('says 未配置 before a key is saved, and 已保存待验证 after', () => {
    expect(line({ hasCredential: false })).toEqual({ message: '还没有配置 API Key', tone: 'info' })
    expect(line()).toEqual({ message: '已保存，还没验证过；点「测试连接」', tone: 'info' })
  })

  it('names the reason when the test failed, one sentence per group', () => {
    const failed = (failureCode: string) => line({ feedback: { kind: 'failed', failureCode } })!
    expect(failed('credential-invalid')).toEqual({ message: '连接失败：API Key 被数据源拒绝', tone: 'error' })
    expect(failed('plan-restricted')).toEqual({ message: '连接失败：当前套餐不允许访问这个接口', tone: 'error' })
    expect(failed('rate-limited')).toEqual({ message: '连接失败：被数据源限流，稍后会自动重试', tone: 'error' })
    expect(failed('transport-unavailable')).toEqual({ message: '连接失败：网络不可达，请检查代理设置', tone: 'error' })
    expect(failed('response-shape-invalid')).toEqual({ message: '连接失败：数据源返回的结构和预期不一样', tone: 'error' })
    // A code nobody maps must still say something true: the generic failure, never the raw code.
    const unknown = failed('some-future-code').message
    expect(unknown.startsWith('连接失败：')).toBe(true)
    expect(unknown).not.toContain('some-future-code')
  })

  it('says the connection works without claiming that anything is collected', () => {
    expect(line({ feedback: { kind: 'succeeded' } })).toEqual({
      message: '连接正常：只验证这个密钥能不能用，本版不采集数据',
      tone: 'success'
    })
    expect(credentialVerificationLine({
      notice: 'verification-only', resolveText: en, hasCredential: true, feedback: { kind: 'succeeded' }
    })).toEqual({
      message: 'Connection works: this version only checks the key; it does not collect data',
      tone: 'success'
    })
  })

  it('stays off for other providers and until the credential state is known', () => {
    expect(line({ notice: 'private-data-source' })).toBeUndefined()
    expect(line({ notice: undefined })).toBeUndefined()
    expect(line({ hasCredential: undefined })).toBeUndefined()
  })

  it('never claims a verification time — that fact cannot be recovered after a restart', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const text = resolveTextIn(language)
      for (const feedback of [{ kind: 'succeeded' } as const, { kind: 'failed', failureCode: 'credential-invalid' } as const, undefined]) {
        const sentence = credentialVerificationLine({
          notice: 'verification-only', resolveText: text, hasCredential: true, feedback
        })?.message ?? ''
        expect(sentence).not.toMatch(/上次验证|last verified/i)
      }
    }
  })
})
