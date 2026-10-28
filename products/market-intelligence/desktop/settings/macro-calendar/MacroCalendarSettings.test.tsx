// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { macroCalendarProviderClient } from '../../shared/ipc/macroCalendarProviderClient'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'
import { macroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import { MacroCalendarSettings } from './MacroCalendarSettings'

const providers = productText['zh-CN'].settings.macroCalendar.providers

vi.mock('../../shared/ipc/macroEconomicCalendarClient', () => ({
  macroEconomicCalendarClient: {
    syncBlsEmploymentSchedule: vi.fn(async () => ({ state: 'completed', schedule: 'unchanged', values: { cpi: 'current', employment: 'current' } }))
  }
}))

vi.mock('../../shared/ipc/marketCalendarClient', () => ({
  marketCalendarClient: { refresh: vi.fn(async () => ({ state: 'completed', sources: ['0xrouter'] })) }
}))

vi.mock('../../shared/ipc/macroCalendarProviderClient', () => ({
  macroCalendarProviderClient: {
    getPageState: vi.fn(async () => ({ state: 'available', providers: [
      { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
      { providerId: 'macro-calendar-bea', enabled: true, scheduleHealth: 'healthy', lastCompletedAt: '2026-08-05T00:00:00.000Z', consecutiveFailures: 0 }
    ] })),
    saveProfile: vi.fn(async () => ({ state: 'saved', provider: { providerId: 'macro-calendar-fed', enabled: true, scheduleHealth: 'never-run', consecutiveFailures: 0 } })),
    runProviderNow: vi.fn(async () => ({ state: 'queued', providerId: 'macro-calendar-bea' })),
    getProviderHealth: vi.fn(async () => ({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })),
    testProviderConnection: vi.fn(async () => ({ state: 'succeeded' })),
    getProviderSchedule: vi.fn(async (providerId: string) => ({ state: 'available', providerId, schedule: { mode: 'interval', intervalSeconds: 21600, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true } }))
  }
}))

let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('MacroCalendarSettings', () => {
  it('syncs the official BLS schedule and lists pending calendar feeds', async () => {
    const container = await render()
    expect(container.textContent).toContain('美国劳工统计局（BLS）')
    expect(container.textContent).toContain('CoinMarketCal')
    await act(async () => button(container, '同步官方 BLS 日程').click())
    await flush()
    expect(macroEconomicCalendarClient.syncBlsEmploymentSchedule).toHaveBeenCalledWith({ year: expect.stringMatching(/^\d{4}$/) })
    expect(container.textContent).toContain('日程已是最新')
  })

  it('renders the 0xRouter market calendar section and refreshes it', async () => {
    const container = await render()
    expect(container.textContent).toContain('市场日历')
    expect(container.textContent).toContain('经济数据')
    expect(container.textContent).toContain('金融事件')
    expect(container.textContent).toContain('央行活动')
    await act(async () => button(container, '立即刷新').click())
    await flush()
    expect(marketCalendarClient.refresh).toHaveBeenCalledWith({ month: expect.stringMatching(/^\d{4}-\d{2}$/), locale: 'zh' })
    expect(container.textContent).toContain('市场日历已刷新。')
  })

  it('uses official provider names in both locales', () => {
    expect(productText['zh-CN'].settings.macroCalendar.providers).toEqual({ 'macro-calendar-fed': 'Federal Reserve Board (Fed)', 'macro-calendar-bea': '美国经济分析局（BEA）' })
    expect(productText['en-US'].settings.macroCalendar.providers).toEqual({ 'macro-calendar-fed': 'Federal Reserve Board (Fed)', 'macro-calendar-bea': 'Bureau of Economic Analysis (BEA)' })
  })

  it('renders the selected provider without the retired UserID controls', async () => {
    const container = await render({ providerId: 'macro-calendar-bea' })
    expect(card(container, providers['macro-calendar-bea'])).toBeTruthy()
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).not.toMatch(/UserID|用户标识|actualValues|requires-user-id/i)
  })

  it('uses the provider-scoped public connection probe in the drawer', async () => {
    const container = await render({ providerId: 'macro-calendar-bea', sourceDrawerMode: true })
    const target = card(container, providers['macro-calendar-bea'])
    await act(async () => button(target, '测试连接').click())
    await flush()
    expect(macroCalendarProviderClient.testProviderConnection).toHaveBeenCalledWith('macro-calendar-bea')
    expect(container.textContent).toContain('连接已验证。')
    expect(container.textContent).not.toMatch(/https?:|credential|UserID/i)
  })

  it('keeps run feedback scoped to the initiating provider', async () => {
    const container = await render()
    const target = card(container, providers['macro-calendar-bea'])
    await act(async () => button(target, '立即运行').click())
    await flush()
    expect(macroCalendarProviderClient.runProviderNow).toHaveBeenCalledWith('macro-calendar-bea')
    expect(target.textContent).toContain('运行请求已排队')
    expect(card(container, providers['macro-calendar-fed']).textContent).not.toContain('运行请求已排队')
  })
  it('applies a saved provider switch to the card', async () => {
    const container = await render()
    const target = card(container, providers['macro-calendar-fed'])
    const control = target.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(control?.getAttribute('aria-checked')).toBe('false')

    await act(async () => control!.click())
    await flush()

    expect(macroCalendarProviderClient.saveProfile).toHaveBeenCalledWith({
      providerId: 'macro-calendar-fed',
      enabled: true
    })
    expect(
      card(container, providers['macro-calendar-fed'])
        .querySelector('button[role="switch"]')
        ?.getAttribute('aria-checked')
    ).toBe('true')
    expect(container.textContent).not.toContain('设置暂不可用，请重试。')
  })

  it('keeps the switch off and shows the error when the save is rejected', async () => {
    vi.mocked(macroCalendarProviderClient.saveProfile).mockResolvedValueOnce({
      state: 'failed',
      failureCode: 'provider-settings-unavailable'
    } as never)
    const container = await render()
    const target = card(container, providers['macro-calendar-fed'])

    await act(async () => target.querySelector<HTMLButtonElement>('button[role="switch"]')!.click())
    await flush()

    expect(
      card(container, providers['macro-calendar-fed'])
        .querySelector('button[role="switch"]')
        ?.getAttribute('aria-checked')
    ).toBe('false')
    expect(container.textContent).toContain('设置暂不可用，请重试。')
  })

})

async function render(props: Partial<React.ComponentProps<typeof MacroCalendarSettings>> = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(MacroCalendarSettings, props)))
  await flush()
  return container
}

function card(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.macro-calendar-settings__card')].find((item) => item.querySelector('h3')?.textContent === name)
  if (!found) throw new Error(`missing card: ${name}`)
  return found
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text))
  if (!found) throw new Error(`missing button: ${text}`)
  return found
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
