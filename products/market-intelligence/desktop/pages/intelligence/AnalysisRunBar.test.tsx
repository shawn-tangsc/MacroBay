// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { AnalysisRunBar, type AnalysisRunBarText } from './AnalysisRunBar'

const text: AnalysisRunBarText = {
  title: '本次运行',
  latestPrefix: '最近一次',
  loading: '正在读取运行记录…',
  unavailable: '记录没拿到',
  empty: '今天还没有分析跑过。',
  ranTitle: '为什么分析了',
  skippedTitle: '哪些没分析',
  unattributed: '原因没记录',
  reasons: { 'significance-confirmed': '数据变化显著，已开始分析', 'signal-cooldown-active': '同一规则还在冷却期内，本次未分析' }
}

/**
 * The bar compares against "today" through the sample clock, which falls back to the real clock
 * without a provider. Cases therefore anchor on `Date.now()`'s own day rather than a fixed date.
 */
function todayAt(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function entry(overrides: Partial<MarketAnalysisTimelineEntry> & Pick<MarketAnalysisTimelineEntry, 'id'>): MarketAnalysisTimelineEntry {
  return {
    eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published',
    occurredAt: todayAt(5), summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: null, version: 1,
    triggerStatus: null, groupType: null, groupSubject: null,
    ...overrides
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(props: Partial<React.ComponentProps<typeof AnalysisRunBar>> = {}): void {
  act(() => root.render(
    <ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <AnalysisRunBar entries={props.entries ?? []} failed={props.failed ?? false} loading={props.loading ?? false} text={text} />
    </ShellTimeZoneProvider>
  ))
}

function summary(): string {
  return host.querySelector('.mi-analysis-run-bar__summary')?.textContent ?? ''
}

function clickSummary(): void {
  const button = host.querySelector('.mi-analysis-run-bar__summary')
  act(() => (button as HTMLButtonElement).click())
}

describe('AnalysisRunBar', () => {
  it('collapses to the newest run\u2019s reason and time, without any count', () => {
    render({ entries: [entry({ id: 'mi-tl-1', triggerStatus: { triggerKey: 'signal.oi', reasonCode: 'significance-confirmed', decidedAt: todayAt(5) } })] })

    expect(summary()).toContain('本次运行')
    expect(summary()).toContain('最近一次：数据变化显著，已开始分析')
    // A count of rows would read as allowance usage ("今天用了几次"), which the bar must not show.
    expect(summary()).not.toMatch(/\d+\s*条/)
    expect(host.querySelector('.mi-analysis-run-bar__summary')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens to the reasons list and keeps the unread skipped list honest', () => {
    render({ entries: [entry({ id: 'mi-tl-1', triggerStatus: { triggerKey: 'signal.oi', reasonCode: 'significance-confirmed', decidedAt: todayAt(5) } })] })
    clickSummary()

    const panel = host.querySelector('.mi-analysis-run-bar__records')
    expect(host.querySelector('.mi-analysis-run-bar__summary')?.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.textContent).toContain('为什么分析了')
    expect(panel?.textContent).toContain('哪些没分析')
    // S2 has not landed: an empty skipped list would claim "nothing was skipped", which we cannot know.
    expect(panel?.textContent).toContain('记录没拿到')
    expect(panel?.textContent).not.toContain('今天还没有运行记录')
  })

  it('says a run without a decision has no recorded reason, and never calls it unanalysed', () => {
    render({ entries: [entry({ id: 'mi-tl-bare' })] })
    clickSummary()

    const rows = host.querySelectorAll('.mi-analysis-run-bar__row')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('原因没记录')
    expect(rows[0]?.getAttribute('data-reason')).toBe('unrecorded')
  })

  it('keeps a cooldown decision in the ran list: it is a decision the ledger explains', () => {
    render({ entries: [entry({ id: 'mi-tl-cool', triggerStatus: { triggerKey: 'signal.oi', reasonCode: 'signal-cooldown-active', decidedAt: todayAt(5) } })] })
    clickSummary()

    expect(host.querySelector('.mi-analysis-run-bar__row')?.textContent).toContain('同一规则还在冷却期内，本次未分析')
  })

  it('distinguishes a failed read from a day without runs', () => {
    render({ failed: true })
    expect(summary()).toContain('记录没拿到')

    act(() => root.render(
      <ShellTimeZoneProvider timeZone="Asia/Shanghai"><AnalysisRunBar entries={[]} failed={false} loading={false} text={text} /></ShellTimeZoneProvider>
    ))
    expect(summary()).toContain('今天还没有分析跑过。')
  })

  it('names the wait instead of an empty list while the read is running', () => {
    render({ loading: true })
    clickSummary()

    expect(summary()).toContain('正在读取运行记录…')
    expect(host.querySelector('.loading-state')).not.toBeNull()
  })

  it('prints no reason code and no allowance number on either state', () => {
    render({ entries: [entry({ id: 'mi-tl-1', triggerStatus: { triggerKey: 'signal.oi', reasonCode: 'significance-confirmed', decidedAt: todayAt(5) } })] })
    clickSummary()

    const visible = host.textContent ?? ''
    expect(visible).not.toContain('significance-confirmed')
    expect(visible).not.toContain('signal.oi')
    expect(visible).not.toMatch(/额度|\d+\s*次/)
  })
})
