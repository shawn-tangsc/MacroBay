// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { BusinessSettingsContent } from './BusinessSettingsView'

/**
 * 采集与数据 › 卡片项：**源没开启**的那一项（用户 2026-11-12）——
 * 开关禁用（`aria-disabled`、零写请求）、整项红辉光（`data-source-disabled`）、
 * 点击这一项才跳到该源配置页（`onOpenSourceConfig`）。源开着 → 开关可编辑、无红辉光、点击不跳。
 */
const t = productText['zh-CN'].settings.intelligenceSources
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(offSourceId?: string) {
  const onOpenSourceConfig = vi.fn()
  const onCellToggle = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(BusinessSettingsContent, {
      business: 'dashboard',
      isCellEnabled: () => true,
      isSourceEnabled: (sourceId: string) => sourceId !== offSourceId,
      onCellToggle,
      onOpenSourceConfig,
      resolveText,
      sourceNames: t.sourceNames
    } as never))
  })
  return { host, onCellToggle, onOpenSourceConfig }
}

describe('卡片项：源没开启', () => {
  it('disables the switch, marks the row and opens the source config on click', async () => {
    const { host, onCellToggle, onOpenSourceConfig } = await render('binance-futures-positioning')
    const row = host.querySelector<HTMLElement>('[data-source-disabled="true"]')
    expect(row).not.toBeNull()
    const control = row!.querySelector<HTMLElement>('[role="switch"]')
    expect(control?.getAttribute('aria-disabled')).toBe('true')
    // 开关点不动：零写请求。
    await act(async () => { control?.click() })
    expect(onCellToggle).not.toHaveBeenCalled()
    // 点整项才跳转，一次。
    await act(async () => { row!.click() })
    expect(onOpenSourceConfig).toHaveBeenCalledTimes(1)
    expect(onOpenSourceConfig).toHaveBeenCalledWith('binance-futures-positioning')
  })

  it('leaves an enabled source editable with no glow and no navigation', async () => {
    const { host, onOpenSourceConfig } = await render(undefined)
    expect(host.querySelector('[data-source-disabled="true"]')).toBeNull()
    const row = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"]')
    expect(row?.querySelector('[role="switch"]')?.getAttribute('aria-disabled')).toBeNull()
    await act(async () => { row?.click() })
    expect(onOpenSourceConfig).not.toHaveBeenCalled()
  })
})
