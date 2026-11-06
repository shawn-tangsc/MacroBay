import type { JobRunOutcome } from '@platform/jobs'

import {
  countTranslationFailure,
  dominantTranslationFailure,
  TRANSLATION_AUTO_OFF_REASON_CODE,
  translationReasonDistribution,
  translationRunReasonCode,
  type BatchFailureReason
} from '../../../contracts/intelligenceTranslationFailure'

export type TranslationBatchConclusion = Pick<JobRunOutcome, 'counts' | 'reasonCode' | 'reasons'>

/**
 * 一批翻译的记账本：跑的过程里累加，跑完一次结算成运行记录要的结论。
 *
 * 为什么结算收在这里而不是散在调用处：`total = succeeded + failed + skipped` 这条恒等式
 * 必须由**一个地方**拼出来，否则三处各加一次，加错的时候平台只会拒写，而拒写之后
 * 我们并不知道是三处里的哪一处算错了。原因码同理：没有失败就不写码。
 */
export type TranslationBatchTally = {
  recordSuccess: () => void
  /** 失败一次（模型调用没成），`errorCode` 是平台给的那个码。 */
  recordFailure: (errorCode: string | undefined) => void
  /** 这一条不需要翻（已是目标语言）或已有可用译文，没有为它调用模型。 */
  recordSkipped: () => void
  settle: () => TranslationBatchConclusion
}

export function createTranslationBatchTally(): TranslationBatchTally {
  let succeeded = 0
  let failed = 0
  let skipped = 0
  const failures: Record<BatchFailureReason, number> = {
    timeout: 0,
    'rate-limited': 0,
    'model-unavailable': 0,
    'model-output-invalid': 0,
    other: 0
  }
  return {
    recordSuccess() {
      succeeded += 1
    },
    recordFailure(errorCode) {
      failed += 1
      countTranslationFailure(failures, errorCode)
    },
    recordSkipped() {
      skipped += 1
    },
    settle() {
      const dominant = failed > 0 ? dominantTranslationFailure(failures) : undefined
      const reasons = failed > 0 ? translationReasonDistribution(failures) : undefined
      return {
        counts: { total: succeeded + failed + skipped, succeeded, failed, skipped },
        // 主因码给「一行话」，分布给「按原因统计」：两层都要，拿主因码反推分布只能说出「出现过」。
        ...(dominant ? { reasonCode: translationRunReasonCode(dominant) } : {}),
        ...(reasons ? { reasons } : {})
      }
    }
  }
}

/**
 * 自动翻译没开的那一批：条数是**跳过**，不是「成功 0 条」。
 *
 * 不知道这一批有几条时返回 `undefined`——宁可让这一行没有计数，也不编一个数出来。
 */
export function translationAutoOffConclusion(requested: number): TranslationBatchConclusion | undefined {
  if (requested <= 0) return undefined
  return {
    counts: { total: requested, succeeded: 0, failed: 0, skipped: requested },
    reasonCode: TRANSLATION_AUTO_OFF_REASON_CODE
  }
}
