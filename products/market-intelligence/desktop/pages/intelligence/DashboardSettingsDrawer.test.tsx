// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'

/**
 * 状态跟着组件搬走之后，最容易丢的是**「要不要弹丢弃确认」这个判断**——
 * 它现在由两个来源合成：当前屏自己上报的脏状态（`screen.dirty`）+ 源树草稿（`sourcesDraftDirty`）。
 * 这里只盯这一处合成：把抽屉壳换成桩，拿到它收到的 `isScreenDirty` 再问一次。
 */
const captured: Array<{ isScreenDirty: () => boolean }> = []
vi.mock('../../settings/config-drawer/ConfigSettingsDrawer', () => ({
  ConfigSettingsDrawer: (props: { isScreenDirty: () => boolean }) => {
    captured.push(props)
    return null
  }
}))

const { DashboardSettingsDrawer } = await import('./DashboardSettingsDrawer')

let root: Root | null = null
afterEach(async () => { await act(async () => root?.unmount()); root = null; captured.length = 0; document.body.replaceChildren() })

async function render(screenDirty: boolean, draftDirty: boolean) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<ConfirmProvider><DashboardSettingsDrawer
    open requestKey={0} initialMenu="analysis" initialSourceFilter="all"
    sourcesDraftDirty={draftDirty}
    screen={{ dirty: screenDirty, saving: false, save: () => undefined }}
    onScreenState={() => undefined} onClose={() => undefined} onDraftChange={() => undefined} /></ConfirmProvider>))
}

it('asks for a discard confirmation when either the screen or the source draft is dirty', async () => {
  await render(true, false)
  expect(captured.at(-1)!.isScreenDirty()).toBe(true)
  await render(false, true)
  expect(captured.at(-1)!.isScreenDirty()).toBe(true)
  await render(true, true)
  expect(captured.at(-1)!.isScreenDirty()).toBe(true)
})

it('stays quiet when nothing is dirty', async () => {
  await render(false, false)
  expect(captured.at(-1)!.isScreenDirty()).toBe(false)
})
