import type { UpdateCheckFailureReason, UpdateCheckResult } from '../contracts/updateCheck'
import { updateCheckFailureReasons } from '../contracts/updateCheck'

/**
 * 落盘的那一份「检查记账」。
 *
 * 为什么要落盘：自动检查的上限是**同一个 UTC 自然日最多一次**，只放内存里，一天重启三次就会查三次。
 * 这里存的都是读者看不见的记账，所以一律按 UTC（改时区不能把额度刷出来）。
 *
 * 读回时一律过 `normalizeUpdateCheckState`：文件是用户可改的，坏值不能把检查永久卡死，
 * 也不能让界面显示一个不存在的状态。
 */
export type StoredUpdateCheckState = {
  /** 自动检查已经记过账的 UTC 日（`YYYY-MM-DD`）；当天再启动就跳过，不发请求。 */
  autoCheckedOnUtcDay: string | null
  /** 最近一次尝试发生的时刻（无论成败）。 */
  lastCheckedAt: string | null
  /** 最近一次**成功**查到的时刻；「暂时查不到」那行显示的就是它。 */
  lastSuccessAt: string | null
  /** 最近一次结论，启动时直接显示缓存，不需要再发请求。 */
  lastResult: UpdateCheckResult | null
  /** 最近一次**手动**检查的时刻；手动冷却 1 分钟按它算。 */
  lastManualCheckedAt: string | null
}

export function createEmptyUpdateCheckState(): StoredUpdateCheckState {
  return {
    autoCheckedOnUtcDay: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastResult: null,
    lastManualCheckedAt: null
  }
}

function readInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

function readDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null
}

function isFailureReason(value: unknown): value is UpdateCheckFailureReason {
  return typeof value === 'string' && (updateCheckFailureReasons as readonly string[]).includes(value)
}

function readResult(value: unknown): UpdateCheckResult | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const checkedAt = readInstant(candidate.checkedAt)
  if (checkedAt === null) return null

  switch (candidate.status) {
    case 'up-to-date':
    case 'available': {
      const latestVersion = candidate.latestVersion
      if (typeof latestVersion !== 'string' || latestVersion.length === 0) return null
      return { status: candidate.status, latestVersion, checkedAt }
    }
    case 'unavailable': {
      if (!isFailureReason(candidate.reason)) return null
      return {
        status: 'unavailable',
        reason: candidate.reason,
        checkedAt,
        lastSuccessAt: readInstant(candidate.lastSuccessAt)
      }
    }
    default:
      return null
  }
}

export function normalizeUpdateCheckState(value: unknown): StoredUpdateCheckState {
  const empty = createEmptyUpdateCheckState()
  if (!value || typeof value !== 'object') return empty
  const candidate = value as Record<string, unknown>
  return {
    autoCheckedOnUtcDay: readDay(candidate.autoCheckedOnUtcDay),
    lastCheckedAt: readInstant(candidate.lastCheckedAt),
    lastSuccessAt: readInstant(candidate.lastSuccessAt),
    lastResult: readResult(candidate.lastResult),
    lastManualCheckedAt: readInstant(candidate.lastManualCheckedAt)
  }
}
