// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
import { FrequencyReadout, frequencyReadoutLine, frequencyReadoutText } from './FrequencyReadout'
import type { FrequencyReadoutView } from './sourceCadence'

/**
 * 频率读数：**整条在 ⓘ 浮层里**，第①行是当前值（界面设计 2026-11-13 v4）。
 *
 * 钉的判据：
 * - 8 种状态各一条文案键，句子**不拼**（`frequencyReadoutLine` 只选键 + 填已格式化的参数）；
 * - 读不到 ≠ 0 ≠ 从未：不写 `--`、不写 0、不写「从未采集」；
 * - 时刻走平台统一格式化（这里把显示时区钉成 UTC，断言的是真值不是「大约」）；
 * - 正文那一行没有了，样式**不许再有截断/不换行**（原来正好切在「约 17:…」）。
 */
const T = productText['zh-CN'].settings.intelligenceSources.collectionPolicy
const resolveText = (key: string): string => resolveProductTextKey('zh-CN', key)
const TIME_ZONE = 'UTC'
const INSTANT = '2026-12-01T06:30:00.000Z'

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function view(overrides: Partial<FrequencyReadoutView> = {}): FrequencyReadoutView {
  return { kind: 'interval', intervalSeconds: 900, next: { kind: 'at', instant: INSTANT }, ...overrides } as FrequencyReadoutView
}

describe('第①行：8 种状态各一条键', () => {
  it.each([
    ['at', {}, `${T.durationMinutes}`],
    ['running', { next: { kind: 'running' } }, ''],
    ['notStarted', { next: { kind: 'notStarted' } }, ''],
    ['unreadable', { next: { kind: 'unreadable' } }, '']
  ] as const)('interval + %s', (kind, overrides, _marker) => {
    const line = frequencyReadoutLine(view(overrides as Partial<FrequencyReadoutView>), TIME_ZONE, resolveText)
    expect(line.params?.interval, kind).toBe('15 分钟')
  })

  it('picks one key per state — the sentence itself is never assembled', () => {
    expect(frequencyReadoutLine(view(), TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutNextAt')
    expect(frequencyReadoutLine(view({ next: { kind: 'running' } } as never), TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutRunning')
    expect(frequencyReadoutLine(view({ next: { kind: 'notStarted' } } as never), TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutNotStarted')
    expect(frequencyReadoutLine(view({ next: { kind: 'unreadable' } } as never), TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutNextUnreadable')
    expect(frequencyReadoutLine({ kind: 'manual' }, TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutManual')
    expect(frequencyReadoutLine({ kind: 'disabled' }, TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutDisabled')
    expect(frequencyReadoutLine({ kind: 'unscheduled' }, TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutUnscheduled')
    expect(frequencyReadoutLine({ kind: 'unreadable' }, TIME_ZONE, resolveText).labelKey)
      .toBe('settings.intelligenceSources.collectionPolicy.readoutScheduleUnreadable')
  })

  it('reads as one sentence, and never as 0 / -- / 「从未」', () => {
    // 跨天时平台格式化器会带上「月-日」，这里两种都接受，但必须是统一格式化的那一刻。
    expect(frequencyReadoutText(view(), TIME_ZONE, resolveText)).toMatch(/^间隔 15 分钟 · 约 (?:\d{2}-\d{2} )?\d{2}:\d{2}$/u)
    expect(frequencyReadoutText({ kind: 'manual' }, TIME_ZONE, resolveText)).toBe(T.readoutManual)
    expect(frequencyReadoutText({ kind: 'disabled' }, TIME_ZONE, resolveText)).toBe(T.readoutDisabled)
    expect(frequencyReadoutText({ kind: 'unscheduled' }, TIME_ZONE, resolveText)).toBe(T.readoutUnscheduled)
    for (const state of [view({ next: { kind: 'running' } } as never), view({ next: { kind: 'notStarted' } } as never), { kind: 'unreadable' } as const]) {
      const sentence = frequencyReadoutText(state, TIME_ZONE, resolveText)
      expect(sentence).not.toMatch(/--|—|从未| 0 /)
    }
  })

  it('says 6 小时 for a six-hour interval instead of 360 分钟', () => {
    expect(frequencyReadoutText(view({ intervalSeconds: 6 * 60 * 60 }), TIME_ZONE, resolveText))
      .toContain('间隔 6 小时')
  })
})

describe('「内置频率」那一行仍在正文里显示读数（不走浮层）', () => {
  it('renders the sentence and is allowed to wrap — no truncation', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(createElement(ShellLanguageProvider, {
        language: 'zh-CN',
        children: createElement(ShellTimeZoneProvider, {
          timeZone: TIME_ZONE,
          children: createElement(FrequencyReadout, { resolveText, view: view() })
        })
      }))
    })
    const row = host.querySelector<HTMLElement>('[data-frequency-readout]')
    expect(row, '读数').not.toBeNull()
    expect(row!.textContent).toContain('间隔 15 分钟')
    // 整批排期读不到：这一行不画（正文不留占位）。
    await act(async () => {
      root!.render(createElement(ShellLanguageProvider, {
        language: 'zh-CN',
        children: createElement(ShellTimeZoneProvider, {
          timeZone: TIME_ZONE,
          children: createElement(FrequencyReadout, { resolveText, view: { kind: 'unreadable' } })
        })
      }))
    })
    expect(host.querySelector('[data-frequency-readout]')).toBeNull()
  })

  it('has no ellipsis/nowrap rule left — the old line cut 「约 17:…」 in half', () => {
    const css = readFileSync(join(__dirname, 'frequencyReadout.css'), 'utf8')
    const readoutRule = css.slice(css.indexOf('.business-card__preset-readout {'))
    const rule = readoutRule.slice(0, readoutRule.indexOf('}'))
    expect(rule).not.toContain('text-overflow')
    expect(rule).not.toContain('nowrap')
    // 放不下就换行，而不是截断。
    expect(rule).toContain('white-space: normal')
  })
})
