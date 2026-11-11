import type { JobRuntime } from '@platform/jobs'

import { crossAssetIndexJobDefinitions } from '../cross-asset/crossAssetIndexJob'
import { macroMarketJobDefinitions } from '../macro-market/macroMarketJob'
import { realMarketApiDxyJobDefinitions } from '../macro-market/realMarketApiDxyJob'

/**
 * 产品自有作业（不是通用适配器采集）按源归属的排期定义。
 *
 * 用户 2026-11-11：**没启用的源不允许被注册到 job 里**——不排期、不发请求；启停一变，job 注册
 * 跟着变。所以这些定义不再由各自的 runtime 在装配时无条件 `setSchedule`：装配只注册 handler，
 * 排期由 `applyRuntimeEligibility` 这一个闸按源的启用状态来开或关。
 *
 * 一个源可以有多条作业（`realmarketapi-market` 同时拥有 DXY 与 Nasdaq 100 两条时钟），所以值
 * 是定义数组，不是一条。
 */
export type SourceOwnedJobDefinition = Readonly<Record<string, unknown>> & Readonly<{ id: string }>

function intervalDefinition(
  definitions: readonly Readonly<Record<string, unknown>>[]
): SourceOwnedJobDefinition {
  const schedule = definitions.find(
    (definition) => (definition.trigger as { kind?: unknown } | undefined)?.kind === 'interval'
  )
  if (!schedule || typeof schedule.id !== 'string') {
    throw new Error('A source-owned job needs one interval definition.')
  }
  return schedule as SourceOwnedJobDefinition
}

export const sourceOwnedJobDefinitions: Readonly<Record<string, readonly SourceOwnedJobDefinition[]>> =
  Object.freeze({
    'twelve-data-market': Object.freeze([intervalDefinition(macroMarketJobDefinitions())]),
    'realmarketapi-market': Object.freeze([
      intervalDefinition(realMarketApiDxyJobDefinitions()),
      intervalDefinition(crossAssetIndexJobDefinitions())
    ])
  })

/** 反向查：这条排期定义属于哪个源。守卫用例用它把 `listSchedules()` 翻译回源。 */
export function sourceOwnedJobSourceId(definitionId: string): string | undefined {
  for (const [sourceId, owned] of Object.entries(sourceOwnedJobDefinitions)) {
    if (owned.some((definition) => definition.id === definitionId)) return sourceId
  }
  return undefined
}

/**
 * 打开 = 按原定义排期；关掉 = 移除定义。
 *
 * 只做 `setSchedule` / `removeSchedule` 两件事：**不**在这里发一次采集（启动立即跑那条仍由
 * 各 runtime 装配时决定），也不判 `readiness`——调用方（`applyRuntimeEligibility`）已经用
 * 同一份有效启用判过了。
 */
export function syncSourceOwnedJobSchedules(input: {
  jobRuntime: JobRuntime
  sourceId: string
  enabled: boolean
}): void {
  const owned = sourceOwnedJobDefinitions[input.sourceId]
  if (!owned) return
  for (const definition of owned) {
    if (input.enabled) input.jobRuntime.setSchedule(definition as never)
    else input.jobRuntime.removeSchedule(definition.id)
  }
}
