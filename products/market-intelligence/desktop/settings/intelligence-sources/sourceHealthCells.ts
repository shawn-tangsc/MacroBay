import {
  formatShellClock,
  formatShellCompactInstant,
  formatShellDay
} from '@platform/ui/time/shellTimeFormat'

import type { SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * B4 健康详情四格：**只在投影给的事实上做词映射**，不在这里判健康档、也不重算 enabled。
 *
 * 四格回答读者四个问题（Chief 2026-11-10）：今天有没有读数、上次成功是什么时候、
 * 为什么没在采、能不能立刻采。每一格的输入都来自服务端投影：
 * - 读数与上次成功：`health.lastSuccessAt`（`getPageState` 的详情）或源上声明的
 *   `unavailable.lastSuccessfulSyncAt`；两者都没有**且这源本就没有逐次记录**（日历 feed）
 *   时是 `unknown`——「拿不到」不许画成「没有」。
 * - 没在采的原因：`enabled` / `readiness` / `visibility` / `unavailable` / `collection` 与
 *   服务端算好的 `credentialStatus.hasCredential`、读者存的 `profile.collectionPreset`。
 * - 能不能立刻采：目录声明的 `supportsRunNow` 与服务端 `runNow` 的门一致（`blocksProductionCollection`
 *   的两档 readiness 都被服务端拒），再加可用性 / 凭据 / 启用三档。
 *
 * 纯函数：时间与 `now` 由调用方给，方便用例钉死「今天」。
 */
export type SourceHealthIdleReason =
  | 'disabled'
  | 'missing-credential'
  | 'unavailable'
  | 'never-ran'
  | 'not-ready'
  | 'manual'
  | 'product-owned'
  | 'collecting'
  | 'unknown'

export type SourceRunNowAnswer =
  | 'yes'
  | 'unsupported'
  | 'not-ready'
  | 'unavailable'
  | 'missing-credential'
  | 'disabled'

export type SourceHealthDetail = Readonly<{
  /** 今天的读数：有（带当天时刻）/ 今天还没有 / 未知。 */
  today: Readonly<{ kind: 'yes'; time: string } | { kind: 'no' } | { kind: 'unknown' }>
  /** 上次成功：有时刻 / 没有成功记录 / 未知（这个源不给逐次记录）。 */
  lastSuccess: Readonly<{ kind: 'known'; text: string } | { kind: 'none' } | { kind: 'unknown' }>
  idleReason: SourceHealthIdleReason
  runNow: SourceRunNowAnswer
  /** 不可用原因码（读者说法已在界面给；码只进 ⓘ）。 */
  unavailableReasonCode?: string
}>

export type SourceHealthFacts = Readonly<{
  source: Pick<SourceView, 'enabled' | 'collection' | 'readiness' | 'visibility' | 'unavailable' | 'capabilities'>
  /** 读者存的采集预设；没读到时不给（不拿默认值冒充）。 */
  profile?: Readonly<{ collectionPreset?: string }>
  /**
   * 服务端的健康读数。`undefined` = **这次没有读它**（日历 feed 不在通用目录里，读了也只会是空壳），
   * 与「读到了但是没有成功记录」是两件事。
   */
  health?: Readonly<{ lastSuccessAt?: string }>
  /** 服务端算好的凭据状态；只有需要凭据的源才有这一格。 */
  credentialStatus?: Readonly<{ hasCredential: boolean }>
  /** 目录声明的「平台允许立即运行」；日历 feed 没有目录声明，就是 `undefined`。 */
  supportsRunNow?: boolean
  now: Date
  timeZone: string
}>

export function computeSourceHealthDetail(input: SourceHealthFacts): SourceHealthDetail {
  const { source } = input
  const todayKey = formatShellDay(input.now.toISOString(), input.timeZone)
  const availability = source.unavailable

  // 「上次成功」只有一个来源：优先服务端健康读数；源上声明的那次「最后成功同步」是第二份**可用事实**，
  // 只在没有健康读数时顶上（不能读成两次成功）。
  const lastAt = input.health?.lastSuccessAt ?? availability?.lastSuccessfulSyncAt
  const lastDay = lastAt === undefined ? null : formatShellDay(lastAt, input.timeZone)

  const lastSuccess: SourceHealthDetail['lastSuccess'] =
    lastAt !== undefined && lastDay !== null
      ? { kind: 'known', text: formatShellCompactInstant(lastAt, { timeZone: input.timeZone }) }
      : input.health !== undefined
        ? { kind: 'none' }
        : { kind: 'unknown' }

  const today: SourceHealthDetail['today'] =
    lastAt === undefined
      ? input.health !== undefined ? { kind: 'no' } : { kind: 'unknown' }
      : lastDay !== null && todayKey !== null && lastDay === todayKey
        ? { kind: 'yes', time: formatShellClock(lastAt, { timeZone: input.timeZone, now: input.now }) ?? '' }
        : { kind: 'no' }

  return {
    today,
    lastSuccess,
    idleReason: idleReasonOf(input, lastAt !== undefined),
    runNow: runNowAnswerOf(input),
    ...(availability === undefined ? {} : { unavailableReasonCode: availability.reasonCode })
  }
}

/** 原因优先级写死在一处：停用 > 未接入 > 取不到 > 缺凭据 > 产品自采 > 手动 > 从没采过 > 按计划。 */
function idleReasonOf(input: SourceHealthFacts, hasSuccess: boolean): SourceHealthIdleReason {
  const { source } = input
  if (!source.enabled) return 'disabled'
  if (source.visibility === 'pending' || source.readiness !== 'live') return 'not-ready'
  if (source.unavailable !== undefined) return 'unavailable'
  if (input.credentialStatus !== undefined && !input.credentialStatus.hasCredential) return 'missing-credential'
  if (source.collection === 'none') return 'product-owned'
  if (input.profile?.collectionPreset === 'manual') return 'manual'
  if (input.health === undefined) return 'unknown'
  return hasSuccess ? 'collecting' : 'never-ran'
}

/** 与服务端 `runNow` 的门一致：`blocksProductionCollection`（planned / fixture-ready）与 `supportsRunNow` 都会拒。 */
function runNowAnswerOf(input: SourceHealthFacts): SourceRunNowAnswer {
  const { source } = input
  if (input.supportsRunNow !== true) return 'unsupported'
  if (source.visibility === 'pending' || source.readiness !== 'live') return 'not-ready'
  if (source.unavailable !== undefined) return 'unavailable'
  if (input.credentialStatus !== undefined && !input.credentialStatus.hasCredential) return 'missing-credential'
  if (!source.enabled) return 'disabled'
  return 'yes'
}
