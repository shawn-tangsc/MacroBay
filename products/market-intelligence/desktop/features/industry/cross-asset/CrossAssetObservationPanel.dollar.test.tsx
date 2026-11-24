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
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.crossAsset
const asOf = '2026-09-14T12:00:00.000Z'
const asOfMs = Date.parse(asOf)
const Scoped = (props: Parameters<typeof CrossAssetObservationPanel>[0]): React.ReactElement =>
  createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(CrossAssetObservationPanel, props) })

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
/** 合成不再挂 pill（用户 2026-11-25）：判据只有「没有 data-synthetic」与 ⓘ 里那句话。 */
const tag = (host: HTMLElement) => host.querySelector('[data-synthetic="dxy"]')
async function openHint(host: HTMLElement): Promise<string> {
  const button = host.querySelector<HTMLButtonElement>('[data-status-row="dxy"] th button')!
  await act(async () => { button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); button.focus() })
  return document.querySelector('[data-row-hint="dxy"]')?.textContent ?? ''
}

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

  it('says the level is computed in the row hint, without a pill beside the name', async () => {
    const host = await render(snapshotOf([syntheticReading]))
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('101.42')
    expect(tag(host)).toBeNull()
    expect(dollarRow(host)?.textContent).not.toContain(text.syntheticTag)
    // 说明搬到行名旁的 ⓘ：那句话在，而且不是靠可访问名硬塞给读屏以外的人。
    expect(await openHint(host)).toContain(text.syntheticCaveat)
  })

  it('falls back to the computed index, label and all, only while the synthesis is the newer one', async () => {
    // 真实那条停住（key 被吊销 / 源被关），篮子还在更新：这才叫回退，而且回退到的是更新的一条。
    const stale = realReading(asOfMs - 30 * 60_000)
    const host = await render(snapshotOf([stale, syntheticReading]))
    expect(host.querySelector('[data-asset-price="dxy"]')?.textContent).toBe('101.42')
    expect(tag(host)).toBeNull()
    expect(host.querySelector('[data-asset-return="dxy:15m"]')?.textContent).toBe('+0.11%')
    expect(await openHint(host)).toContain(text.syntheticCaveat)
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

  it('keeps the row description in the ⓘ, and adds the age sentence there only once stale', async () => {
    // 正文不再印说明文字：行名旁只有一颗 ⓘ，浮层里第一段是这一行的说明句。
    const fresh = await render(snapshotOf([realReading()]))
    const freshTrigger = fresh.querySelector<HTMLButtonElement>('[data-status-row="dxy"] button[aria-label]')!
    await act(async () => freshTrigger.click())
    expect(document.body.textContent).toContain(text.statusReads.dxy)
    // 新鲜时浮层里没有那句日期。
    expect(document.body.textContent).not.toContain('偏旧 · 截至')
  })

  it('moves the age sentence into the same ⓘ once the reading passes the one stale threshold', async () => {
    const stale = await render(snapshotOf([realReading(asOfMs - 31 * 60_000)]))
    const trigger = stale.querySelector<HTMLButtonElement>('[data-status-row="dxy"] button[aria-label]')!
    await act(async () => trigger.click())
    expect(document.body.textContent).toContain('偏旧 · 截至 2026-09-14 11:29:00 GMT')
  })

  it('covers a row whose source is unavailable, and offers no switch to hide it', async () => {
    // 用户 2026-11-16 第二版：**默认开**（不显示这类行），开关关掉才显示；显示时整行遮住、只剩一句状态。
    const refused = { ...realReading(asOfMs - 48 * 60 * 60_000), sourceFailure: 'symbol-not-supported' as const }
    const host = await render(snapshotOf([refused]))
    // 隐藏开关撤了（用户 2026-11-25）：被拒的行照实遮一行，读者能看出它断了。
    expect(host.querySelector('[role="switch"]')).toBeNull()
    const row = dollarRow(host)
    expect(row?.getAttribute('data-source-state')).toBe('unreadable')
    expect(row?.textContent).toContain(text.sourceRefused)
    expect(row?.querySelector('[data-asset-price]')).toBeNull()
    expect(row?.querySelectorAll('[data-asset-return]')).toHaveLength(0)
    expect(row?.querySelector('button[aria-label]')).toBeNull()
  })
})
