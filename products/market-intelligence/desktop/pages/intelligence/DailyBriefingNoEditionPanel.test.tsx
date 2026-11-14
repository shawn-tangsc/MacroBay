// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingNoEditionPanel } from './DailyBriefingNoEditionPanel'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const formatTime = (value: string) => value.slice(0, 16).replace('T', ' ')

const view = { status: 'no-edition' as const, date: '2026-11-14', failed: false }
const base = {
  view,
  text,
  timeZone: 'Asia/Shanghai',
  scheduledTime: '20:00',
  todayDate: '2026-11-14',
  formatTime,
  onOpenSettings: () => undefined
}
const row = (languages: { locale: 'zh-CN' | 'en-US'; state: string }[], periodDeleted = false, periodId = 'period_x') => ([{
  date: '2026-11-14', periodId, periodDeleted, languages
}] as never)

/**
 * 「读不到这一版」与「这一版没生成」是两件事（用户 2026-11-14）：
 * 列表按**同一 (date, periodId, locale)** 说这一语言发布过、正文却读不到时，绝不许说「没有生成」。
 */
describe('the pane that has nothing to read', () => {
  it('says the read failed when the same issue and language is published but the body is missing', () => {
    const html = renderToStaticMarkup(createElement(DailyBriefingNoEditionPanel, {
      ...base,
      selection: { periodId: 'period_x', locale: 'zh-CN' },
      editions: row([{ locale: 'zh-CN', state: 'published' }]),
      onReread: () => undefined
    } as never))
    expect(html).toContain('读取没有完成')
    expect(html).not.toContain('没有生成')
  })

  it('keeps "this issue was not generated" when that language was never published', () => {
    const html = renderToStaticMarkup(createElement(DailyBriefingNoEditionPanel, {
      ...base,
      selection: { periodId: 'period_x', locale: 'zh-CN' },
      editions: row([{ locale: 'en-US', state: 'published' }]),
      onReread: () => undefined
    } as never))
    expect(html).toContain('没有生成')
    expect(html).not.toContain('读取没有完成')
  })

  it('treats a deleted period as "nothing", never as a read failure', () => {
    const html = renderToStaticMarkup(createElement(DailyBriefingNoEditionPanel, {
      ...base,
      selection: { periodId: 'period_x', locale: 'zh-CN' },
      editions: row([{ locale: 'zh-CN', state: 'published' }], true),
      onReread: () => undefined
    } as never))
    expect(html).not.toContain('读取没有完成')
  })
})

// 这一屏要能在日志里说清「按哪个三元组判的」——用户那一版就是没有任何痕迹，查了很久。
describe('the diagnostic line', () => {
  it('names the triple it judged by when the store says published but the pane has no body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderToStaticMarkup(createElement(DailyBriefingNoEditionPanel, {
      ...base,
      // 用一个新的期次号：模块级去重会记住前面用例打过的三元组，重复身份不会再打。
      selection: { periodId: 'period_diag', locale: 'zh-CN' },
      editions: row([{ locale: 'zh-CN', state: 'published' }], false, 'period_diag'),
      onReread: () => undefined
    } as never))
    const call = warn.mock.calls.find((entry) => String(entry[0]).includes('published edition has no body'))
    // 日志必须是一行能读的 JSON（对象交给 Electron 会落成 `[object Object]`）。
    const raw = String(call?.[0])
    const payload = JSON.parse(raw.slice(raw.indexOf('{"date"')))
    expect(payload).toMatchObject({ date: '2026-11-14', periodId: 'period_diag', locale: 'zh-CN', viewStatus: 'no-edition' })
    warn.mockRestore()
  })
})
