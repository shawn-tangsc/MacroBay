// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { MacroIndicatorDrawer } from './MacroIndicatorDrawer'
import { EXPECTATION_BIN_PX } from './ExpectationChart'
import { productText } from '../../shared/i18n/productText'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
})

function Harness({ onOpened }: Readonly<{ onOpened: () => void }>): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => { setOpen(true); onOpened() }}>open</button>
    {open ? <MacroIndicatorDrawer locale="zh-CN" onClose={() => setOpen(false)} onRetryPolicy={() => undefined} policyText={text} /> : null}
  </>
}

describe('key-indicator drawer', () => {
  it('mounts as a modal drawer with a mask, and closes when the mask is clicked', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    let opened = 0
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><Harness onOpened={() => { opened += 1 }} /></ShellLanguageProvider>)
    })
    const trigger = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'open')!
    await act(async () => { trigger.click() })
    expect(opened).toBe(1)
    // The drawer is portalled to body: a drawer rendered inside the rail gets clipped by it, and
    // that looks exactly like "the button does nothing".
    // 平台 modal 抽屉：遮罩 + 右侧浮层由 antd 负责，本组件只提供内容。
    const drawer = document.body.querySelector('.ant-drawer')
    expect(drawer).not.toBeNull()
    expect(drawer!.querySelector('.mk-sec')).not.toBeNull()
    const mask = document.body.querySelector('.ant-drawer-mask')
    expect(mask).not.toBeNull()
    // 兜底那条 CSS 的命中条件，逐项钉住（`:has()` 本身由浏览器实现，这里验它的前提）：
    const drawerRoot = document.body.querySelector('.ant-drawer')!
    expect(drawerRoot.classList.contains('drawer--modal')).toBe(true)
    expect(drawerRoot.querySelector('.drawer__panel.mk-drawer')).not.toBeNull()
    // 遮罩必须是 `.ant-drawer` 的直接子元素，`:has(...) > .ant-drawer-mask` 才可能命中。
    expect(drawerRoot.querySelector(':scope > .ant-drawer-mask')).toBe(mask)
    await act(async () => { (mask as HTMLElement).click() })
    expect(document.body.querySelector('.mk-sec')).toBeNull()
  })

  it('really turns the mini calendar page, disables 回到本月 on the current month, and shows a refresh state', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const byName = (name: string) => document.body.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement
    const title = () => document.body.querySelector('.mk-minical__h h3')!.textContent
    expect(title()).toContain('2026 年 11 月')
    expect(byName('回到本月').disabled).toBe(true)
    await act(async () => { byName('上一个月').click() })
    expect(title()).toContain('2026 年 10 月')
    expect(byName('回到本月').disabled).toBe(false)
    await act(async () => { byName('回到本月').click() })
    expect(title()).toContain('2026 年 11 月')
    await act(async () => { byName('刷新市场日历').click() })
    expect(document.body.querySelector('.mk-minical__busy')).not.toBeNull()
  })

  it('lists release names in the cells: three rows, then 「N 条重要」 in the bottom-right corner', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const cells = Array.from(document.body.querySelectorAll('.mk-minical__day'))
    // 2026-11-13 carries five releases in the prototype's data: three named rows + 「2 条重要」.
    const busy = cells.find(cell => cell.querySelector('em')?.textContent === '13' && cell.querySelector('.mk-mcell__row'))!
    expect(busy).toBeTruthy()
    expect(busy.querySelectorAll('.mk-mcell__row')).toHaveLength(3)
    expect(busy.querySelector('.mk-mcell__more')?.textContent).toBe('2 条重要')
  })

  it('keeps the header to a title and one close control — no calendar link', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const header = document.body.querySelector('.ant-drawer-header')!
    expect(header.textContent).toContain('关键指标 · 预期变化')
    expect(header.textContent).not.toContain('经济日历')
    // 页头只剩一个按钮（关闭）；多一个就是又长出了入口。
    expect(header.querySelectorAll('button')).toHaveLength(1)
    // Chief 的点名判据：页头里的链接数量必须是 0。
    expect(header.querySelectorAll('a')).toHaveLength(0)
    // `.mk-drawer` 必须真的包住正文——样式选择器写错时这条会红。
    expect(document.body.querySelector('.mk-drawer .ant-drawer-body')).not.toBeNull()
  })

  it('reuses the calendar day list, so its surprise and asset lines stay', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    // 用户 2026-11-13：右列直接复用日历页那套列表，它自带的两行保留。
    const list = document.body.querySelector('.mk-col-r .mi-calendar-day-list')
    expect(list).not.toBeNull()
    expect(list!.textContent).toContain('上周EIA原油库存变化')
  })

  it('says 暂无日程数据 in a month that has no releases', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const prev = document.body.querySelector('button[aria-label="上一个月"]') as HTMLButtonElement
    const next = document.body.querySelector('button[aria-label="下一个月"]') as HTMLButtonElement
    // 10 → 11 → 12 → 2027-01 (empty in the prototype's data)
    for (let step = 0; step < 2; step += 1) await act(async () => { next.click() })
    expect(document.body.querySelector('.mk-minical__nodata')?.textContent).toBe('暂无日程数据')
    await act(async () => { prev.click() })
    expect(document.body.querySelector('.mk-minical__nodata')).toBeNull()
  })
})

const reading: PolicyPathReading = {
  meetingDate: '2026-12-09', daysUntilMeeting: 26, hasProjectionMaterials: true,
  phase: { kind: 'normal' },
  targetRange: { lowerPercent: 3.75, upperPercent: 4 },
  lastDecision: { vote: { for: 10, against: 2 }, outcome: 'no-change' },
  probability: { venue: 'polymarket', asOf: '2026-11-12T02:10:00.000Z', outcome: 'hike-25', value: 0.878, changeInPp24h: 2.1 },
  staleness: 'live'
}

describe('policy card inside the drawer', () => {
  it('draws the reading the host already has, not a second read', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} policyReading={reading} /></ShellLanguageProvider>)
    })
    const slot = document.body.querySelector('.mk-policy-slot')!
    expect(slot.querySelector('.mi-policy-card')).not.toBeNull()
    expect(slot.textContent).toContain('87.8%')
  })

  it('shows the unreadable form rather than inventing a number', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const slot = document.body.querySelector('.mk-policy-slot')!
    expect(slot.textContent).not.toContain('%')
  })
})

describe('the note lives in the info popover', () => {
  const note = macroIndicatorDrawerText['zh-CN'].rateNote

  it('keeps the explanation out of the body text', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const head = document.body.querySelector('.mk-sechead')!
    expect(head.textContent).not.toContain('纵轴＝加权期望')
    expect(head.textContent).not.toContain('零以上')
  })

  it('shows the same sentence inside the icon popover, and the icon precedes the readout', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const head = document.body.querySelector('.mk-sechead')!
    const trigger = head.querySelector('button[aria-label="利率数学期望的说明"]') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    // 标题 → ⓘ → 读数：图标必须在读数之前，不能跟到数字后面。
    const readout = head.querySelector('.mk-sec__v')!
    expect(trigger.compareDocumentPosition(readout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trigger.getAttribute('aria-describedby')).toBeTruthy()
    await act(async () => { trigger.click() })
    expect(document.body.textContent).toContain(note)
    expect(document.body.textContent).toContain('零以上')
  })
})

describe('expectation curve inside the drawer', () => {
  const early = { 'no-change': 0.2, 'hike-25': 0.75, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
  const late = { 'no-change': 0.1, 'hike-25': 0.8, 'hike-50-plus': 0.05, 'cut-25': 0.04, 'cut-50-plus': 0.01 }
  const withSeries: PolicyPathReading = {
    ...reading,
    probability: {
      ...reading.probability!,
      expectationChange24hBp: 0.4,
      series: [
        { at: '2026-10-30T00:00:00.000Z', values: early },
        { at: '2026-11-12T23:00:00.000Z', values: late }
      ]
    }
  }

  const render = async (drawerReading?: PolicyPathReading) => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} onRetryPolicy={() => undefined} policyText={text}
        {...(drawerReading ? { policyReading: drawerReading } : {})} /></ShellLanguageProvider>)
    })
  }

  it('draws the stored series: 25×hike25 + 50×hike50+ − 25×cut25 − 50×cut50+', async () => {
    await render(withSeries)
    // 末点：25×0.8 + 50×0.05 − 25×0.04 − 50×0.01 = 21.0bp，一位小数。
    expect(document.body.querySelector('.mk-sec__v')?.textContent).toBe('21.0bp')
    expect(document.body.querySelector('.mk-sec__d')?.textContent).toBe('↑ +0.4bp · 较上一日')
    const plot = document.body.querySelector('.mk-plot')!
    expect(plot.querySelector('.mk-plot__svg')).not.toBeNull()
    expect(plot.querySelector('.state-view')).toBeNull()
    // 数据全为正：零轴贴底，不出现蓝区（C3）。
    expect(plot.querySelector('rect[fill="url(#mk-g-blue)"]')).toBeNull()
  })

  it('says there is no history instead of printing +0.0bp', async () => {
    const { expectationChange24hBp: _dropped, ...withoutChange } = withSeries.probability!
    await render({ ...withSeries, probability: withoutChange })
    expect(document.body.querySelector('.mk-sec__d')?.textContent).toBe('无历史可比')
  })

  it('turns an unreadable read into the error state with one retry action, and draws no curve', async () => {
    await render()
    const plot = document.body.querySelector('.mk-plot')!
    expect(plot.querySelector('.mk-plot__svg')).toBeNull()
    expect(plot.querySelector('.state-view--error')).not.toBeNull()
    expect(document.body.querySelector('.mk-sec__v')?.textContent).toBe('暂时读不到')
  })

  it('bins the real volume — 1662 observations must not become 1662 vertices', async () => {
    const start = Date.parse('2026-10-30T10:46:22.223Z')
    const step = (13.5 * 86_400_000) / 1661
    const series = Array.from({ length: 1662 }, (_unused, index) => ({
      at: new Date(start + index * step).toISOString(),
      values: late
    }))
    await render({ ...withSeries, probability: { ...withSeries.probability!, series } })
    const line = document.body.querySelector('.mk-plot__svg path[stroke="var(--accent)"]')
    expect(line).not.toBeNull()
    const vertices = (line!.getAttribute('d')!.match(/[ML]/g) ?? []).length
    // 顶点数只由箱数决定（每箱 3px，图宽几百像素 → 一百多个箱），与观测条数无关。
    // happy-dom 量的宽度不稳，所以这里钉的是量级：远少于 1662，且不是几个点糊过去。
    expect(EXPECTATION_BIN_PX).toBe(3)
    expect(vertices).toBeGreaterThan(80)
    expect(vertices).toBeLessThan(200)
  })

  it('marks a release on the curve only when the curve actually moved', async () => {
    const before = { 'no-change': 0.45, 'hike-25': 0.5, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
    const after = { 'no-change': 0.25, 'hike-25': 0.7, 'hike-50-plus': 0.03, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
    const reading: PolicyPathReading = {
      ...withSeries,
      probability: {
        ...withSeries.probability!,
        series: [
          { at: '2026-11-10T13:20:00.000Z', values: before },
          { at: '2026-11-10T13:40:00.000Z', values: after }
        ]
      }
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined}
        onRetryPolicy={() => undefined} policyText={text} policyReading={reading}
        releaseEvents={[{ at: '2026-11-10T13:30:00.000Z', label: 'CPI 年率' }]} /></ShellLanguageProvider>)
    })
    // 期望差：25×(0.70−0.50) = +5.0bp，标注贴在图顶。
    expect(document.body.querySelector('.mk-plot__svg')?.textContent).toContain('↑ +5.0bp CPI 年率')
  })

  it('shows no annotation when the host passes no events', async () => {
    await render(withSeries)
    expect(document.body.querySelector('.mk-plot__svg')?.textContent ?? '').not.toContain('bp CPI')
  })

  it('shows the empty state, not a flat line, when the reading carries no points', async () => {
    const { series: _noSeries, ...probability } = withSeries.probability!
    await render({ ...withSeries, probability })
    const plot = document.body.querySelector('.mk-plot')!
    expect(plot.querySelector('.mk-plot__svg')).toBeNull()
    expect(plot.querySelector('.state-view--empty')).not.toBeNull()
  })
})
