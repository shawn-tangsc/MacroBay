import type { OffscreenCaptureOutcome } from '@platform/desktop/main/window/offscreenCaptureWindow'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPosterFiles } from './briefingPosterFiles'
import type { BriefingPosterStore } from './briefingPosterStore'

/**
 * 出图生产者：给一版版次，落一张海报，并把「成了/失败了/超时了」记成一行。
 *
 * 三条与裁决绑在一起的规矩：
 * - **失败不抛**：出图是新增链路里最可能失败的一段，它不该让版次或通知跟着失败。所以这里只回
 *   结果，由调用点决定「不带 hash 提交」。
 * - **有证据**：失败与超时各记一行（`status` + `failure_code`）。只靠「记录里没带 hash」判，
 *   会把「失败」显示成「没有」。
 * - **只有 ready 才有 hash**：没画成却带着 hash 提交，读者会点开一张不存在的图。
 */
export type BriefingPosterRenderInput = Readonly<{
  date: string
  periodId: string
  locale: DailyBriefingLocale
  /** 这一版的身份（版次 `generatedAt`）：海报行按它分版本，重生成不覆盖旧行。 */
  editionGeneratedAt: string
}>

export type BriefingPosterRenderOutcome =
  | Readonly<{ ok: true; contentHash: string }>
  | Readonly<{ ok: false; status: 'failed' | 'timeout'; code: string }>

export type BriefingPosterProducer = Readonly<{
  render: (input: BriefingPosterRenderInput) => Promise<BriefingPosterRenderOutcome>
}>

export function createBriefingPosterProducer(input: Readonly<{
  capture: (target: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => Promise<OffscreenCaptureOutcome>
  files: Pick<BriefingPosterFiles, 'write'>
  store: Pick<BriefingPosterStore, 'record'>
}>): BriefingPosterProducer {
  return {
    async render(target) {
      const captured = await input.capture({
        date: target.date,
        periodId: target.periodId,
        locale: target.locale
      })

      if (!captured.ok) {
        const timeout = captured.reason === 'timeout'
        const code = timeout
          ? 'poster-render-timeout'
          : captured.detail === undefined ? `poster-${captured.reason}` : `poster-${captured.reason}:${captured.detail}`
        input.store.record({
          ...target,
          status: timeout ? 'timeout' : 'failed',
          failureCode: code
        })
        return { ok: false, status: timeout ? 'timeout' : 'failed', code }
      }

      const written = await input.files.write(captured.bytes)
      if (!written.ok) {
        const code = written.reasonCode === 'image_too_large' ? 'poster-too-large' : 'poster-unsupported-type'
        input.store.record({ ...target, status: 'failed', failureCode: code })
        return { ok: false, status: 'failed', code }
      }

      input.store.record({
        ...target,
        status: 'ready',
        contentHash: written.file.contentHash,
        byteLength: written.file.byteLength,
        ...(written.file.width === undefined ? {} : { width: written.file.width }),
        ...(written.file.height === undefined ? {} : { height: written.file.height })
      })
      return { ok: true, contentHash: written.file.contentHash }
    }
  }
}
