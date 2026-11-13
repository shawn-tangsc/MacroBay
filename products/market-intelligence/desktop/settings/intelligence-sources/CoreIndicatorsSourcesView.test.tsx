// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { CoreIndicatorsSourcesView } from './CoreIndicatorsSourcesView'

/**
 * 「核心指标」这一屏的四条（Chief + 架构师 2026-11-14）：
 * 行来自唯一派生点；缺配置 = 开；总闸关掉时置灰并给去处；腿全关时说「所有源已关闭」而不是「暂无数据」。
 */
const t = productText['zh-CN'].settings.intelligenceSources
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)
const names: Record<string, string> = { narwhal: 'Narwhal 经济数据', 'fred-rates-liquidity': 'FRED', bls: 'BLS' }

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(overrides: Partial<Parameters<typeof CoreIndicatorsSourcesView>[0]> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(CoreIndicatorsSourcesView, {
    resolveText,
    sourceNameOf: (providerId: string) => names[providerId],
    sourceEnabled: () => true,
    disabled: {},
    onToggle: vi.fn(),
    ...overrides
  })))
  return host
}

describe('core indicator source page', () => {
  it('lists one card per indicator, with the legs the derivation table gives', async () => {
    const host = await render()
    const cards = [...host.querySelectorAll<HTMLElement>('[data-core-indicator]')]
    expect(cards.map((card) => card.getAttribute('data-core-indicator'))).toEqual([
      'US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE', 'US.CORE_PCE.NSA.YOY'
    ])
    // 新增就业的官方腿是 BLS；其余三个是 FRED。盘口不在这一页。
    const payrolls = host.querySelector('[data-core-indicator="US.NONFARM.SA.CHANGE"]')!
    expect(payrolls.textContent).toContain('BLS')
    expect(payrolls.textContent).not.toContain('Polymarket')
    expect(host.textContent).not.toContain('Polymarket')
  })

  it('shows the switch as ON when there is no saved preference', async () => {
    const host = await render()
    const switches = [...host.querySelectorAll<HTMLElement>('[data-core-source-row] .ant-switch')]
    expect(switches.length).toBeGreaterThan(0)
    for (const item of switches) expect(item.getAttribute('aria-checked')).toBe('true')
  })

  it('grays a row out when the source itself is off, and offers the way to open it', async () => {
    const onOpenSource = vi.fn()
    const host = await render({ sourceEnabled: (providerId) => providerId !== 'narwhal', onOpenSource })
    const row = host.querySelector<HTMLElement>('[data-core-source-row="US.CPI.NSA.YOY|narwhal"]')!
    expect(row.getAttribute('data-gate-off')).toBe('true')
    // antd Switch 在禁用时给原生 `disabled`，不是 `aria-disabled`——按真实标记断言。
    const control = row.querySelector<HTMLButtonElement>('button.ant-switch') ?? row.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(control?.disabled).toBe(true)
    // 那一行里有两个按钮（开关 + 去数据源），按类选，别撞到开关上。
    const jump = row.querySelector<HTMLButtonElement>('.core-indicator-sources__open')!
    expect(jump.textContent).toBe(t.coreIndicators.valueSourceOpenSource)
    await act(async () => jump.click())
    expect(onOpenSource).toHaveBeenCalledWith('narwhal')
  })

  it('says all sources are off, which is not the same sentence as having no data', async () => {
    const host = await render({
      disabled: { 'US.CPI.NSA.YOY|narwhal': true, 'US.CPI.NSA.YOY|fred-rates-liquidity': true }
    })
    const card = host.querySelector<HTMLElement>('[data-core-indicator="US.CPI.NSA.YOY"]')!
    expect(card.textContent).toContain(t.coreIndicators.valueSourceAllClosed)
    expect(card.textContent).not.toContain(t.coreIndicators.valueSourceEmpty)
  })
})
