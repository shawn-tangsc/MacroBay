// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellClock } from '@platform/ui/time/shellTimeFormat'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { FrequencyReadout } from './FrequencyReadout'
import type { FrequencyReadoutView } from './sourceCadence'

/**
 * 下拉下方那一行读数（原型 2026-11-13）。
 *
 * 钉的判据：两段独立、不可判定的几种各自有说法、**不写 `--`/`0`/「从未」**、
 * 时刻走平台统一格式化（这里把显示时区钉成 UTC，所以断言的是真值不是「大约」）。
 */
const T = productText['zh-CN'].settings.intelligenceSources.collectionPolicy.readout
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(view: FrequencyReadoutView): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(ShellTimeZoneProvider, {
        timeZone: 'UTC',
        children: createElement(FrequencyReadout, { resolveText, view })
      })
    }))
  })
  return host
}

const INSTANT = '2026-12-01T06:30:00.000Z'

describe('频率读数那一行', () => {
  it('正常态：间隔 + 推算出来的下次时刻（读者时区），两段之间一颗「·」', async () => {
    const host = await render({ kind: 'interval', intervalSeconds: 900, next: { kind: 'at', instant: INSTANT } })
    const row = host.querySelector<HTMLElement>('[data-frequency-readout]')
    expect(row, '读数').not.toBeNull()
    expect(row!.textContent).toContain('间隔 15 分钟')
    // 时刻由平台格式化器给，不在这里拼：跨天它会自己带上月-日。
    expect(row!.textContent).toContain(formatShellClock(INSTANT, { timeZone: 'UTC' })!)
    expect(row!.querySelectorAll('.business-card__preset-readout-sep')).toHaveLength(1)
    expect(row!.textContent).not.toMatch(/--|—|从未/)
  })

  it('整天数：6 小时按小时说，不写成 360 分钟', async () => {
    const host = await render({ kind: 'interval', intervalSeconds: 6 * 60 * 60, next: { kind: 'running' } })
    expect(host.textContent).toContain('间隔 6 小时')
  })

  it.each([
    ['running', T.nextRunning],
    ['never', T.nextNever],
    ['unreadable', T.nextUnreadable],
    ['offline', T.nextOffline]
  ] as const)('有间隔、第二段是 %s：说这一段的实话，不拿占位顶替', async (kind, copy) => {
    const host = await render({ kind: 'interval', intervalSeconds: 900, next: { kind } })
    const row = host.querySelector<HTMLElement>('[data-frequency-readout]')
    expect(row!.textContent).toContain('间隔 15 分钟')
    expect(row!.textContent).toContain(copy)
    expect(row!.textContent).not.toMatch(/--|—|从未/)
  })

  it('手动档：只写「手动：不自动采集」，不写间隔、不写「—」', async () => {
    const host = await render({ kind: 'manual' })
    const row = host.querySelector<HTMLElement>('[data-frequency-readout]')
    expect(row!.getAttribute('data-frequency-readout')).toBe('manual')
    expect(row!.textContent).toBe(T.manualOnly)
    expect(row!.textContent).not.toContain('间隔')
    expect(row!.querySelectorAll('.business-card__preset-readout-sep')).toHaveLength(0)
  })

  it('源未启用：只写「未启用，不采集」', async () => {
    const host = await render({ kind: 'disabled' })
    expect(host.textContent).toBe(T.disabledNoCollect)
  })

  it('排期里没有它：只写「未安排」，**不显示间隔**（不从开关反推）', async () => {
    const host = await render({ kind: 'unscheduled' })
    expect(host.textContent).toBe(T.unscheduled)
    expect(host.textContent).not.toContain('间隔')
  })

  it('整批读不到：这一行不画占位（原因进同一颗 ⓘ）', async () => {
    const host = await render({ kind: 'unreadable' })
    expect(host.querySelector('[data-frequency-readout]')).toBeNull()
    expect(host.textContent).not.toMatch(/--|—|0/)
  })
})
