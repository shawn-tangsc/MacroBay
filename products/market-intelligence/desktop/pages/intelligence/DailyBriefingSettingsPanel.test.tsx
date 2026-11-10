// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { productText } from '../../shared/i18n/productText'
import { useDailyBriefingSettingsBlocks } from './DailyBriefingSettingsBlocks'

/**
 * 「保存失败要点名是哪一块失败」——外壳（那个抽屉）退役后，这条判据挂在块自己的保存路径上，
 * **不是**随关窗确认一起消失。这里直接驱动那块用的 hook，不经过任何外壳。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

type Blocks = ReturnType<typeof useDailyBriefingSettingsBlocks>

function fakeClient(saveFails: boolean): Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'> {
  const view = { settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false }, periods: [], periodsUnreadable: false }
  return {
    getSettings: vi.fn(async () => ({ state: 'available' as const, view })) as never,
    saveSettings: vi.fn(async () => (saveFails ? { state: 'unavailable' as const, failureCode: 'failed' } : { state: 'available' as const, view })) as never
  }
}

async function mountBlocks(client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>): Promise<() => Blocks> {
  let latest: Blocks
  function Probe(): null {
    latest = useDailyBriefingSettingsBlocks({ client, open: true })
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(Probe) })))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return () => latest
}

describe('the briefing blocks save', () => {
  it('names the block that failed to save', async () => {
    ;(window as unknown as { platform: unknown }).platform = { modelProviders: { list: vi.fn(async () => []) } }
    const current = await mountBlocks(fakeClient(true))
    expect(current().ai.state).toBe('ready')
    const onSaved = vi.fn()
    await act(async () => { await current().saveAll(onSaved) })
    expect(onSaved).not.toHaveBeenCalled()
    expect(current().failed).toEqual(['ai'])
    expect(current().failedSentence).toContain(text.settingsDrawer.sectionFailed.ai)
  })

  it('does not name any block when the save goes through', async () => {
    ;(window as unknown as { platform: unknown }).platform = { modelProviders: { list: vi.fn(async () => []) } }
    const current = await mountBlocks(fakeClient(false))
    const onSaved = vi.fn()
    await act(async () => { await current().saveAll(onSaved) })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(current().failed).toEqual([])
    expect(current().failedSentence).toBeNull()
  })
})
