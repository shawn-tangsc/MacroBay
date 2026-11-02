import type { StatusPillTone } from '@platform/ui/components/status-pill'

import type { PlatformText } from '../../i18n/platformText'

/**
 * 模型服务状态词 → 药丸档位（唯一一份，两个渲染点读同一张表）。
 *
 * 界面设计 2026-11-02 定的档位表，附一条硬规则：**同一个词全仓只许一档**。
 * - 可用 `ok`、不可用 `muted`——「不可用」不是出错，是条件不具备；红色会让人以为系统坏了；
 * - 待检测 `muted`（旧结论过期，还没测，不是坏事）；
 * - 下线 `muted`——单纯告知。她给的「仍被选为默认供应商 → `warn`」是**供应商级**的处境，
 *   模型行里没有这个状态；那一屏出现时从这里加一个词，不要在调用点另写一张表。
 */
export type ModelStatusWord = 'available' | 'unavailable' | 'stale' | 'retired'

export const MODEL_STATUS_PILL_TONES: Record<ModelStatusWord, StatusPillTone> = {
  available: 'ok',
  unavailable: 'muted',
  stale: 'muted',
  retired: 'muted'
}

/** `StatusPill` 只收键：字面量键只在下面这一处写，调用点不拼键。 */
export const MODEL_STATUS_PILL_KEYS: Record<ModelStatusWord, string> = {
  available: 'models.modelAvailabilityOk',
  unavailable: 'models.modelAvailabilityFailed',
  stale: 'models.modelAvailabilityStale',
  retired: 'models.modelRetiredTag'
}

const TEXT_OF: Record<ModelStatusWord, (labels: PlatformText['models']) => string> = {
  available: (labels) => labels.modelAvailabilityOk,
  unavailable: (labels) => labels.modelAvailabilityFailed,
  stale: (labels) => labels.modelAvailabilityStale,
  retired: (labels) => labels.modelRetiredTag
}

/** 键 → 句子；未知键返回空串，不回退键名（与抽屉、`StatusPill` 调用点同一约定）。 */
export function resolveModelStatusPillText(key: string, labels: PlatformText['models']): string {
  const word = (Object.keys(MODEL_STATUS_PILL_KEYS) as ModelStatusWord[]).find(
    (candidate) => MODEL_STATUS_PILL_KEYS[candidate] === key
  )
  return word === undefined ? '' : TEXT_OF[word](labels)
}

/** 本次检测的状态词 → 药丸档位（界面设计 2026-11-02：通过 ok、失败 bad、检测中 info、跳过/停止 muted）。 */
export type DetectionStatusWord = 'testing' | 'ok' | 'failed' | 'skipped' | 'cancelled'

export const DETECTION_STATUS_PILL_TONES: Record<DetectionStatusWord, StatusPillTone> = {
  testing: 'info',
  ok: 'ok',
  failed: 'bad',
  skipped: 'muted',
  cancelled: 'muted'
}

export const DETECTION_STATUS_PILL_KEYS: Record<DetectionStatusWord, string> = {
  testing: 'models.detectionStatus.testing',
  ok: 'models.detectionStatus.ok',
  failed: 'models.detectionStatus.failed',
  skipped: 'models.detectionStatus.skipped',
  cancelled: 'models.detectionStatus.cancelled'
}

const DETECTION_TEXT_OF: Record<DetectionStatusWord, (labels: PlatformText['models']) => string> = {
  testing: (labels) => labels.detectionStatusLabel('testing'),
  ok: (labels) => labels.detectionStatusLabel('ok'),
  failed: (labels) => labels.detectionStatusLabel('failed'),
  skipped: (labels) => labels.detectionStatusLabel('skipped'),
  cancelled: (labels) => labels.detectionStatusLabel('cancelled')
}

/** 键 → 短词；未知键返回空串（与其它组件同一约定）。 */
export function resolveDetectionStatusPillText(key: string, labels: PlatformText['models']): string {
  const word = (Object.keys(DETECTION_STATUS_PILL_KEYS) as DetectionStatusWord[]).find(
    (candidate) => DETECTION_STATUS_PILL_KEYS[candidate] === key
  )
  return word === undefined ? '' : DETECTION_TEXT_OF[word](labels)
}
