import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intelligence-module-market-data-test' },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import { createJobRuntime } from '@platform/jobs'
import { net } from 'electron'

import { allSources } from './application/providerRegistry'
import { intelligenceCollectJobId } from './application/sourceRuntimeOrchestrator'
import { createIntelligenceStores } from './intelligenceModuleStores'
import { createIntelligenceMarketData } from './intelligenceModuleMarketData'
import { resolveFactSource } from '../../contracts/factSources'

/**
 * M3 抽出来的这一段自己的用例（2026-11-15 拆分 `intelligenceModule.ts`）。
 *
 * 核心是**就绪解析的相等断言**：`etf-net-flow` 由谁供，是启动链上的判断——声明了、读者开着、
 * 作业真的注册着、就绪为 live 才算候选。这段逻辑搬到工厂里之后，**同一份输入必须给出与搬前
 * 逐项相同的结果**；「跑起来没报错」证明不了这件事。所以这里在测试里重写一遍判据当 oracle，
 * 与工厂的输出比。工厂要是漏了某个条件（例如把「作业注册」丢掉），这里立刻红。
 */
const directories: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mi-market-data-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
  directories.length = 0
})

/**
 * 真实的存储 + 可控的 profile 与排期。
 *
 * `profileStore` 必须可控：判定链里「读者开着」那一环要是走注册表默认值，多数源默认关，
 * 用例会**永远只走到 none**，把「作业注册」那一环删掉也不会红——那是假绿。
 */
async function marketData(input: { scheduledJobIds: readonly string[]; enabledSourceIds: readonly string[] }) {
  const { scheduledJobIds, enabledSourceIds } = input
  const dataDir = tempDir()
  const stores = createIntelligenceStores({
    dataDir,
    getAppLanguage: async () => 'zh-CN' as const,
    timeZone: () => 'UTC'
  })
  /* 真作业运行时（市场数据装配会 `registerHandler`/`setSchedule`），只把「已注册的排期」换成可控值。 */
  const real = createJobRuntime()
  const jobRuntime = new Proxy(real, {
    get(target, property) {
      if (property === 'listSchedules') return () => scheduledJobIds.map((id) => ({ id }))
      const value = Reflect.get(target, property) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  }) as unknown as Parameters<typeof createIntelligenceMarketData>[0]['jobRuntime']
  const profileStore = {
    resolveProfile: async (sourceId: string) => ({ sourceId, enabled: enabledSourceIds.includes(sourceId) })
  } as never
  const created = createIntelligenceMarketData({
    jobRuntime,
    dataDir,
    profileStore,
    credentialStore: stores.credentialStore,
    pipeline: stores.pipeline,
    macroMarketStore: stores.macroMarketStore,
    macroCalendarEvidenceArchive: stores.macroCalendarEvidenceArchive,
    timeZone: () => 'UTC',
    platformFetch: net.fetch as never
  })
  return { created, stores, profileStore }
}

/** 搬前的判据，一字不差地写在测试里当 oracle。 */
async function expectedResolution(
  profileStore: { resolveProfile: (sourceId: string) => Promise<{ enabled: boolean }> },
  scheduledJobIds: readonly string[]
) {
  const scheduled = new Set(scheduledJobIds)
  const declared = allSources().filter((source) => source.provides?.includes('etf-net-flow') === true)
  const candidates = []
  for (const source of declared) {
    const profile = await profileStore.resolveProfile(source.sourceId)
    candidates.push({
      sourceId: source.sourceId,
      provides: source.provides!,
      enabled: profile.enabled,
      jobRegistered: scheduled.has(intelligenceCollectJobId(source.sourceId)),
      readiness: source.readiness
    })
  }
  return resolveFactSource({ factId: 'etf-net-flow', sources: candidates })
}

const DECLARED = allSources().filter((source) => source.provides?.includes('etf-net-flow') === true)

describe('intelligenceModule 市场数据段', () => {
  it('读者开着但没有注册采集作业时解析成 none——「注册」那一环不能丢', async () => {
    const enabled = DECLARED.map((source) => source.sourceId)
    const { created, profileStore } = await marketData({ scheduledJobIds: [], enabledSourceIds: enabled })
    expect(await created.resolveEtfFactSource()).toEqual(await expectedResolution(profileStore, []))
    expect(await created.resolveEtfFactSource()).toEqual({ kind: 'none' })
  })

  it('两源都开着且都注册了作业时，按优先级取主源——不再是 conflict（用户 2026-11-17）', async () => {
    const enabled = DECLARED.map((source) => source.sourceId)
    const scheduled = DECLARED.map((source) => intelligenceCollectJobId(source.sourceId))
    const { created } = await marketData({ scheduledJobIds: scheduled, enabledSourceIds: enabled })
    const actual = await created.resolveEtfFactSource()
    // 主源 CryptoETF 在前：备源开着也不会把结果顶成 conflict，更不会让两源都不采。
    expect(actual).toEqual({ kind: 'resolved', sourceId: 'cryptoetf-etf-flows' })
    expect(await created.resolveEtfFactSource()).toEqual(actual)
  })

  it('主源关掉时退到备源 0xRouter——「互相补充」的那一半', async () => {
    const scheduled = DECLARED.map((source) => intelligenceCollectJobId(source.sourceId))
    const { created } = await marketData({ scheduledJobIds: scheduled, enabledSourceIds: ['0xrouter-aggregate-provider'] })
    expect(await created.resolveEtfFactSource()).toEqual({ kind: 'resolved', sourceId: '0xrouter-aggregate-provider' })
  })

  it('读者关着时，即使作业注册着也解析成 none——「开关」那一环不能丢', async () => {
    const scheduled = DECLARED.map((source) => intelligenceCollectJobId(source.sourceId))
    const { created, profileStore } = await marketData({ scheduledJobIds: scheduled, enabledSourceIds: [] })
    expect(await created.resolveEtfFactSource()).toEqual(await expectedResolution(profileStore, scheduled))
    expect(await created.resolveEtfFactSource()).toEqual({ kind: 'none' })
  })

  it('装配出的市场数据读口都在（少一个，看板或日历的读口就断一条）', async () => {
    const { created } = await marketData({ scheduledJobIds: [], enabledSourceIds: [] })
    expect(typeof created.resolveEtfFactSource).toBe('function')
    expect(typeof created.dashboardFeedStatus.status).toBe('function')
    expect(created.fundingRateHistoryStore).toBeTruthy()
    expect(created.perpetualPositioningStore).toBeTruthy()
    expect(created.etfCurrentStateRefresh).toBeTruthy()
    expect(created.zeroXRouterCalendarEvidenceAdmission).toBeTruthy()
    expect(created.capitalConditions).toBeTruthy()
    expect(created.macroMarket).toBeTruthy()
  })
})
