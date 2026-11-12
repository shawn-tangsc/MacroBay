// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIntelligenceSourcesSettings } from './useIntelligenceSourcesSettings'

/**
 * 写失败要看得见（读者 2026-11-13 真机：「选完弹回、什么都没发生」）。
 *
 * 判据三条：
 * 1. 按源保存失败 → 值回滚，**并且**给出一句人话（`saveFailure`），不是静默弹回；
 * 2. 「重试」= **再跑一次那次写**（同一份 patch），不是整页重读——第二次成功就清掉提示，
 *    值才真的落上；
 * 3. 没有失败动作时点重试什么都不做（不许变成「假装成功」或「多发一次写」）。
 */
const LABELS = {
  loadFailed: '加载失败', saveFailed: '保存失败', saved: '已保存', disabledSaved: '已停用',
  enabledManualHint: '手动', enabledAutoCollectQueued: '已排队', runFailed: '运行失败',
  runQueued: '已排队', runSucceeded: '成功', testFailed: '测试失败', replayFailed: '重放失败',
  focusGroups: { globalMacro: '', digitalAssets: '', aggregateProviders: '', multiMarketDynamic: '', plannedMarkets: '', pending: '' }
}

const PROFILE = {
  profileId: 'coindesk-rss-profile',
  sourceId: 'coindesk-rss',
  enabled: true,
  collectionPreset: 'balanced' as const,
  scopePolicy: 'all' as const,
  rawArchiveEnabled: true,
  retentionMode: 'balanced' as const,
  autoReplayAfterParserUpgrade: true,
  updatedAt: '2026-11-13T00:00:00.000Z'
}

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

type Probe = {
  saveFailure: () => string | null
  presetOf: () => string | undefined
  save: (preset: string) => void
  retry: () => void
}

async function mountProbe(): Promise<Probe> {
  const probe: Probe = { saveFailure: () => null, presetOf: () => undefined, save: () => {}, retry: () => {} }
  function Host(): null {
    const hook = useIntelligenceSourcesSettings(LABELS)
    probe.saveFailure = () => hook.saveFailure
    probe.presetOf = () => hook.profiles.find((profile) => profile.sourceId === 'coindesk-rss')?.collectionPreset
    probe.save = (preset) => hook.updateSourceProfile('coindesk-rss', { collectionPreset: preset as never })
    probe.retry = () => hook.retryFailedSave()
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => { root!.render(createElement(Host)); await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return probe
}

/** 第一条保存失败、之后成功：正好用来验「先红后绿」的重试。 */
function installIpc(): { saves: () => number } {
  let saves = 0
  const invoke = vi.fn(async (_productId: string, method: string, payload?: { collectionPreset?: string }) => {
    if (method === 'intelligenceSources.getPageState') return { definitions: [], sourceHealthById: {} }
    if (method === 'intelligenceSources.listProfiles') return [PROFILE]
    if (method === 'intelligenceSources.getSettingsView') return { groups: [], counts: { total: 0, enabled: 0, pending: 0, failed: 0 } }
    if (method === 'intelligenceSources.saveProfile') {
      saves += 1
      if (saves === 1) throw new Error('save failed')
      return { profile: { ...PROFILE, collectionPreset: payload?.collectionPreset ?? PROFILE.collectionPreset } }
    }
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  return { saves: () => saves }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

describe('写失败：说得出话，也重试得了', () => {
  it('rolls the value back and says the save failed', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()

    await act(async () => { probe.save('frequent') })
    await flush()

    expect(ipc.saves(), 'attempted once').toBe(1)
    // 值回滚到改前那一档：失败不许画成已生效。
    expect(probe.presetOf()).toBe('balanced')
    expect(probe.saveFailure()).toBe(LABELS.saveFailed)
  })

  it('retries that same write and clears the notice once it lands', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()

    await act(async () => { probe.save('frequent') })
    await flush()
    expect(probe.saveFailure()).toBe(LABELS.saveFailed)

    await act(async () => { probe.retry() })
    await flush()

    expect(ipc.saves()).toBe(2)
    expect(probe.presetOf()).toBe('frequent')
    expect(probe.saveFailure()).toBeNull()
  })

  it('does nothing when there is no failed write to retry', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()

    await act(async () => { probe.retry() })
    await flush()

    expect(ipc.saves()).toBe(0)
    expect(probe.saveFailure()).toBeNull()
  })
})
