// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notifySettingsRevision } from '../../shared/events/settingsRevision'
import { useIntelligenceSourcesSettings } from './useIntelligenceSourcesSettings'

/**
 * C8：两处联动。
 *
 * 另一处保存了「来源」域 → 本页重读；**有草稿时不覆盖**，只提示，由读者选「重新载入 / 继续编辑」。
 * 这里驱动真实的 hook（不 mock 它），只把 IPC 换成桩——判据要看的是「有没有再读一次」。
 */
const LABELS = {
  loadFailed: '加载失败', saveFailed: '保存失败', saved: '已保存', disabledSaved: '已停用',
  enabledManualHint: '手动', enabledAutoCollectQueued: '已排队', runFailed: '运行失败',
  runQueued: '已排队', runSucceeded: '成功', testFailed: '测试失败', replayFailed: '重放失败',
  focusGroups: { globalMacro: '', digitalAssets: '', aggregateProviders: '', multiMarketDynamic: '', plannedMarkets: '', pending: '' }
}

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

type Probe = {
  setDraft: (dirty: boolean) => void
  reload: () => void
  dismiss: () => void
  banner: () => boolean
  toggle: (sourceId: string, enabled: boolean) => Promise<boolean>
}

async function mountProbe(): Promise<Probe> {
  const probe: Probe = {
    setDraft: () => {}, reload: () => {}, dismiss: () => {}, banner: () => false,
    toggle: async () => false
  }
  function Host(): null {
    const hook = useIntelligenceSourcesSettings(LABELS)
    probe.setDraft = hook.setDraftDirty
    probe.reload = hook.reloadFromOtherSide
    probe.dismiss = hook.dismissOtherSideChanged
    probe.banner = () => hook.otherSideChanged
    probe.toggle = (sourceId, enabled) => hook.toggleSourceEnabled({ sourceId, kind: 'feed' }, enabled)
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => { root!.render(createElement(Host)); await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return probe
}

function installIpc(): { reads: () => number } {
  let reads = 0
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'intelligenceSources.getSettingsView') reads += 1
    if (method === 'intelligenceSources.getPageState') {
      return { definitions: [], sourceHealthById: {} }
    }
    if (method === 'intelligenceSources.listProfiles') return []
    if (method === 'intelligenceSources.getSettingsView') return { groups: [], counts: { total: 0, enabled: 0, pending: 0, failed: 0 } }
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  return { reads: () => reads }
}

describe('settings linkage (C8)', () => {
  it('reloads silently when another place saves and this page has no draft', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()
    expect(ipc.reads()).toBe(1)

    await act(async () => { notifySettingsRevision('sources', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(ipc.reads()).toBe(2)
    expect(probe.banner()).toBe(false)
  })

  it('keeps the draft and only shows the notice when this page is editing', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()
    expect(ipc.reads()).toBe(1)

    act(() => probe.setDraft(true))
    await act(async () => { notifySettingsRevision('sources', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 没有重读（草稿没被覆盖），提示立起来。
    expect(ipc.reads()).toBe(1)
    expect(probe.banner()).toBe(true)
  })

  it('reloads on demand and clears the notice; keep-editing clears it without losing the draft', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()

    act(() => probe.setDraft(true))
    await act(async () => { notifySettingsRevision('sources', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(probe.banner()).toBe(true)

    // 继续编辑：只收起提示，没有重读。
    act(() => probe.dismiss())
    expect(probe.banner()).toBe(false)
    expect(ipc.reads()).toBe(1)

    // 再一次另一处保存：草稿仍在，提示重新出现。
    await act(async () => { notifySettingsRevision('sources', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(probe.banner()).toBe(true)

    // 重新载入：丢草稿、按另一处的值重读。
    await act(async () => { probe.reload() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(ipc.reads()).toBe(2)
    expect(probe.banner()).toBe(false)
  })

  it('re-reads after a save, instead of trusting what is in memory', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()
    expect(ipc.reads()).toBe(1)

    await act(async () => { await probe.toggle('s1', false) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    // 写入一次，然后**重读**一次：内存里的乐观值不是真相。
    expect(ipc.reads()).toBe(2)
  })

  it('ignores revisions for other domains', async () => {
    const ipc = installIpc()
    const probe = await mountProbe()

    await act(async () => { notifySettingsRevision('notifications', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(ipc.reads()).toBe(1)
    expect(probe.banner()).toBe(false)
  })
})
