// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { MacroIndicatorDrawer } from './MacroIndicatorDrawer'
import { productText } from '../../shared/i18n/productText'
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
    {open ? <MacroIndicatorDrawer locale="zh-CN" onClose={() => setOpen(false)} policyText={text} /> : null}
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
    await act(async () => { (mask as HTMLElement).click() })
    expect(document.body.querySelector('.mk-sec')).toBeNull()
  })

  it('really turns the mini calendar page, disables 回到本月 on the current month, and shows a refresh state', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} policyText={text} /></ShellLanguageProvider>)
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
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const cells = Array.from(document.body.querySelectorAll('.mk-minical__day'))
    // 2026-11-13 carries five releases in the prototype's data: three named rows + 「2 条重要」.
    const busy = cells.find(cell => cell.querySelector('em')?.textContent === '13' && cell.querySelector('.mk-mcell__row'))!
    expect(busy).toBeTruthy()
    expect(busy.querySelectorAll('.mk-mcell__row')).toHaveLength(3)
    expect(busy.querySelector('.mk-mcell__more')?.textContent).toBe('2 条重要')
  })

  it('draws each day row as exactly time + name — no type chip, no surprise, no assets', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const rows = Array.from(document.body.querySelectorAll('.mk-evr'))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.children).toHaveLength(2)
      expect(row.children[0]!.tagName.toLowerCase()).toBe('time')
      expect(row.children[1]!.tagName.toLowerCase()).toBe('span')
      // 原型右列没有这三样；出现任一条就说明又回到了多行版本。
      expect(row.textContent).not.toContain('超预期')
      expect(row.textContent).not.toContain('QQQ')
      expect(row.textContent).not.toContain('经济指标')
    }
  })

  it('says 暂无日程数据 in a month that has no releases', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} policyText={text} /></ShellLanguageProvider>)
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
  probability: { venue: 'polymarket', asOf: '2026-11-12T02:10:00.000Z', outcome: 'hike-25', value: 0.878, changeInPp24h: 2.1, points: 40 },
  staleness: 'live'
}

describe('policy card inside the drawer', () => {
  it('draws the reading the host already has, not a second read', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} policyText={text} policyReading={reading} /></ShellLanguageProvider>)
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
      root!.render(<ShellLanguageProvider language="zh-CN"><MacroIndicatorDrawer locale="zh-CN" onClose={() => undefined} policyText={text} /></ShellLanguageProvider>)
    })
    const slot = document.body.querySelector('.mk-policy-slot')!
    expect(slot.textContent).not.toContain('%')
  })
})
