// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { CrossAssetObservationPanel } from './CrossAssetObservationPanel'
import { productText } from '../../../shared/i18n/productText'
import { macroMarketSnapshotPublicPolicy } from '../../../../contracts/macro/macroMarketSnapshotContracts'

/**
 * The dollar row's label is the whole point of these tests: a level this product computed wears
 * 「合成」, and the licensed index never does. The three states are the states the row can be in —
 * licensed, computed fallback, and nothing at all.
 *
 * 读者 2026-10-17 的实况也在这里（「这个美元这里怎么还有合成字样」）：周末 FX 收盘，真实那条的最后一根
 * 是周五，而合成那条早就停了。行必须继续显示**真实**那条（只是旧），不能换成另一件东西还挂个标签。
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
const asOf = '2026-09-14T12:00:00.000Z'
const asOfMs = Date.parse(asOf)
const Scoped = (props: Parameters<typeof CrossAssetObservationPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(CrossAssetObservationPanel, props))

const realReading = (atMs = asOfMs) => ({
  seriesId: macroMarketSnapshotPublicPolicy.series.dollarIndexReal, level: 102.24, atMs,
  returns: { '15m': 0.12, '1h': 0.34, '24h': 0.78, '7d': 0.56 }
})
const syntheticReading = {
  seriesId: macroMarketSnapshotPublicPolicy.series.dollarIndex, level: 101.42, atMs: asOfMs,
  returns: { '15m': 0.11, '1h': 0.33, '24h': 0.77, '7d': 0.55 }, synthetic: true as const
}
const snapshotOf = (readings: readonly unknown[]) => ({
  state: 'available', asOf, source: { enabled: true, hasCredential: true },
  readings, caveats: readings.some(reading => (reading as { synthetic?: true }).synthetic) ? ['synthetic-dollar-index'] : []
})

const hosts: HTMLElement[] = []
afterEach(() => { for (const host of hosts.splice(0)) host.remove() })

async function render(macroSnapshot: unknown): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const client = { acquire: async () => ({ state: 'unavailable' }), query: async () => ({ state: 'unavailable' }), release: async () => ({ state: 'released' }) }
  await act(async () => createRoot(host).render(createElement(Scoped, { client: client as never, macroSnapshot: macroSnapshot as never, text })))
  return host
}

const dollarRow = (host: HTMLElement) => host.querySelector<HTMLTableRowElement>('[data-status-row="dxy"]')
const tag = (host: HTMLElement) => host.querySelector('[data-synthetic="dxy"]')

describe('the dollar row on the market-status table', () => {
  it('shows the licensed index with no 合成 label at all', async () => {
    const host = await render(snapshotOf([realReading()]))
    expect(dollarRow(host)?.dataset.connected).toBe('true')
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('102.24')
    expect(host.querySelector('[data-asset-return="dxy:24h"]')?.textContent).toBe('+0.78%')
    // The one assertion this whole change exists for: no tag, no caveat, no "synthetic" wording.
    expect(tag(host)).toBeNull()
    expect(dollarRow(host)?.textContent).not.toContain(text.syntheticTag)
  })

  it('shows the computed index with its 合成 label while the real source is unconfigured', async () => {
    const host = await render(snapshotOf([syntheticReading]))
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('101.42')
    expect(tag(host)?.textContent).toBe(text.syntheticTag)
    expect(tag(host)?.getAttribute('title')).toBe(text.syntheticCaveat)
    expect(tag(host)?.getAttribute('data-caveat')).toBe(macroMarketSnapshotPublicPolicy.caveats.syntheticDollarIndex)
  })

  it('falls back to the computed index, label and all, only while the synthesis is the newer one', async () => {
    // 真实那条停住（key 被吊销 / 源被关），篮子还在更新：这才叫回退，而且回退到的是更新的一条。
    const stale = realReading(asOfMs - 30 * 60_000)
    const host = await render(snapshotOf([stale, syntheticReading]))
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('101.42')
    expect(tag(host)?.textContent).toBe(text.syntheticTag)
    expect(host.querySelector('[data-asset-return="dxy:15m"]')?.textContent).toBe('+0.11%')
  })

  it('keeps the real index, without a label, when the synthesis is not newer — the weekend case', async () => {
    // 读者截图里的形状：真实那条是周五的收盘价（几小时前），合成那条两天前就停了。
    const stale = realReading(asOfMs - 6 * 60 * 60_000)
    const older = { ...syntheticReading, atMs: asOfMs - 2 * 24 * 60 * 60_000 }
    const host = await render(snapshotOf([stale, older]))
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('102.24')
    expect(host.querySelector('[data-asset-return="dxy:24h"]')?.textContent).toBe('+0.78%')
    expect(tag(host)).toBeNull()
    expect(dollarRow(host)?.textContent).not.toContain(text.syntheticTag)
  })

  it('prints 未接入 and no figure when neither the real nor the computed series has a level', async () => {
    const host = await render(snapshotOf([{ seriesId: 'xau-usd', level: 3412.55, atMs: asOfMs, returns: {} }]))
    const row = dollarRow(host)
    expect(row?.dataset.connected).toBe('false')
    expect(row?.textContent).toContain(text.notConnected)
    expect(row?.querySelectorAll('[data-asset-price], [data-asset-return]')).toHaveLength(0)
    expect(tag(host)).toBeNull()
  })
})
