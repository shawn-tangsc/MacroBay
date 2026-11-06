import { describe, expect, it } from 'vitest'

import {
  BATCH_FAILURE_REASONS,
  countTranslationFailure,
  dominantTranslationFailure,
  translationReasonDistribution,
  settledTranslationFailures,
  TRANSLATION_AUTO_OFF_REASON_CODE,
  translationFailureKindOf,
  translationRunReasonCode,
  type BatchFailureReason
} from './intelligenceTranslationFailure'

/**
 * 每一类都必须**有构造用例证明它能出现**（Chief 2026-11-06 定的验收口径）。
 *
 * 只给「超时」写一条，其余四类照样可能是死码——这条文件按类分组，每组都用**平台真会返回的
 * 错误码**把那一类撞出来，撞不出来的类就是不该进表的类。
 */
const PLATFORM_CODES = [
  'model-not-ready',
  'provider-disabled',
  'missing-api-key',
  'timeout',
  'cancelled',
  'rate-limited',
  'provider-error',
  'invalid-json',
  'schema-validation-failed'
] as const

function emptyTally(): Record<BatchFailureReason, number> {
  return { timeout: 0, 'rate-limited': 0, 'model-unavailable': 0, 'model-output-invalid': 0, other: 0 }
}

describe('translation failure kinds', () => {
  it('超时：平台返回 timeout 时归到「超时」', () => {
    expect(translationFailureKindOf('timeout')).toBe('timeout')
  })

  it('被限流：平台返回 rate-limited 时归到「被限流」', () => {
    expect(translationFailureKindOf('rate-limited')).toBe('rate-limited')
  })

  it('没配好模型：缺 key、供应商停用、模型未就绪三种码都归到「没配好模型」', () => {
    expect(translationFailureKindOf('missing-api-key')).toBe('model-unavailable')
    expect(translationFailureKindOf('provider-disabled')).toBe('model-unavailable')
    expect(translationFailureKindOf('model-not-ready')).toBe('model-unavailable')
  })

  it('模型输出不合法：不是 JSON、不合 schema 都归到「输出不合法」', () => {
    expect(translationFailureKindOf('invalid-json')).toBe('model-output-invalid')
    expect(translationFailureKindOf('schema-validation-failed')).toBe('model-output-invalid')
  })

  it('其它：供应商报错、调用被取消，以及任何不认识的码都落到「其它」', () => {
    expect(translationFailureKindOf('provider-error')).toBe('other')
    // 被取消不是「太慢」：模型根本没拿到预算，说成超时会把读者引到错的处置上。
    expect(translationFailureKindOf('cancelled')).toBe('other')
    expect(translationFailureKindOf('something-new')).toBe('other')
    expect(translationFailureKindOf(undefined)).toBe('other')
  })

  it('闭集覆盖平台的每一个错误码，没有「落在表外」的码', () => {
    // 平台加了新码而这里没跟上时，它会被静默折进「其它」——这条把「静默」变成可见：
    // 已知的九个码各自归到具体一类，「其它」只留 provider-error / cancelled。
    for (const code of PLATFORM_CODES) {
      const kind = translationFailureKindOf(code)
      expect(BATCH_FAILURE_REASONS).toContain(kind)
      const expected: BatchFailureReason[] = code === 'provider-error' || code === 'cancelled'
        ? ['other']
        : []
      if (expected.length > 0) expect(expected).toContain(kind)
    }
    const mapped = PLATFORM_CODES.filter((code) => translationFailureKindOf(code) !== 'other')
    expect(mapped).toHaveLength(7)
  })

  it('按类归并：同一类只累加次数，摘要里不写 0', () => {
    const tally = emptyTally()
    countTranslationFailure(tally, 'timeout')
    countTranslationFailure(tally, 'timeout')
    countTranslationFailure(tally, 'rate-limited')
    expect(settledTranslationFailures(tally)).toEqual({ timeout: 2, 'rate-limited': 1 })
    expect(settledTranslationFailures(emptyTally())).toEqual({})
  })

  it('运行记录的原因码是点分枚举，一个类一个码，不含句子', () => {
    const codes = BATCH_FAILURE_REASONS.map((kind) => translationRunReasonCode(kind))
    expect(codes).toEqual([
      'model.timeout',
      'model.rate-limited',
      'model.not-configured',
      'model.output-invalid',
      'translation.undetermined'
    ])
    // 平台的写入校验只收点分小写；一句人话会被当场拒写。
    for (const code of [...codes, TRANSLATION_AUTO_OFF_REASON_CODE]) {
      expect(code).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
    }
  })

  it('一批里失败原因不止一种时，记录写发生最多的那一类', () => {
    const tally = emptyTally()
    countTranslationFailure(tally, 'rate-limited')
    countTranslationFailure(tally, 'timeout')
    countTranslationFailure(tally, 'rate-limited')
    expect(dominantTranslationFailure(tally)).toBe('rate-limited')
    // 没有失败就不该有原因码：空结论不是「其它」。
    expect(dominantTranslationFailure(emptyTally())).toBeUndefined()
    // 主因码之外还要给分布：一个码说不出「超时 1、限流 2」。
    expect(translationReasonDistribution(tally)).toEqual({
      'model.rate-limited': 2,
      'model.timeout': 1
    })
    expect(translationReasonDistribution(emptyTally())).toBeUndefined()
  })
})
