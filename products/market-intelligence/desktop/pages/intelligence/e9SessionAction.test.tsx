// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigProvider } from 'antd'
import { ConfirmProvider } from '@platform/ui/components/confirm'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import type { DailyBriefingStoredEdition } from '../../../service/intelligence/daily-briefing/dailyBriefingService'
import { briefingHistorySummaries } from '../../../service/intelligence/daily-briefing/dailyBriefingHistory'
import { productText } from '../../shared/i18n/productText'
import { DailyBriefingHistoryRail } from './DailyBriefingHistoryRail'

/**
 * E9 的整条链：历史投影（期 × 语言 → 会话）→ 行尾动作渲染 → 点开落到**同一条**会话。
 *
 * 分成两截测是不够的：投影带 id、行会渲染、点击会调回调，三处各自绿，中间任何一处把 id
 * 弄丢都不会红。这条用例从头走到尾，任何一个环节丢 id 都断在同一个断言上。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const storedEdition: DailyBriefingStoredEdition = {
  date: '2026-11-02',
  periodId: 'default',
  locale: 'zh-CN',
  generatedAt: '2026-11-02T00:00:00.000Z',
  windowStart: '2026-11-02T00:00:00.000Z',
  windowEnd: '2026-11-02T00:00:00.000Z',
  document: {
    schemaVersion: 1,
    policyVersion: 'daily-briefing.v1',
    edition: {
      date: '2026-11-02', locale: 'zh-CN', generatedAt: '2026-11-02T00:00:00.000Z',
      windowStart: '2026-11-02T00:00:00.000Z', windowEnd: '2026-11-02T00:00:00.000Z', timeZone: 'Asia/Shanghai'
    },
    status: { readings: [], readingsAvailable: 4, readingsTotal: 4 },
    lede: { source: 'template', text: '', generatedAt: '2026-11-02T00:00:00.000Z' },
    news: { items: [], macro: [], notes: {} },
    data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
    conclusion: null,
    next: { items: [] },
    citations: [],
    provenance: { summaryId: null, readAt: '2026-11-02T00:00:00.000Z' }
  }
}

let host: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(summary: Parameters<typeof DailyBriefingHistoryRail>[0]['editions'][number], onOpenSession?: (input: Readonly<{ sessionId: string; date: string; periodId: string; locale: 'zh-CN' | 'en-US' }>) => Promise<boolean>) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(
    <ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><ConfirmProvider>
      <DailyBriefingHistoryRail
        editions={[summary]}
        todayDate="2026-11-02"
        locale="zh-CN"
        text={text}
        timeZone="Asia/Shanghai"
        onSelect={() => undefined}
        {...(onOpenSession === undefined ? {} : { onOpenSession })}
      />
    </ConfirmProvider></ConfigProvider>
  ))
}

describe('E9: the row opens exactly the session the projection named', () => {
  it('carries the id from the projection into the row, and the click opens that same session', async () => {
    const asked: unknown[] = []
    const [summary] = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [storedEdition], otherRows: [],
      sessionId: async (date, periodId, locale) => { asked.push({ date, periodId, locale }); return 'session-1' }
    })
    // 投影按「期 × 语言」问一次，拿到的那条写进这一行。
    expect(asked).toEqual([{ date: '2026-11-02', periodId: 'default', locale: 'zh-CN' }])
    expect(summary?.sessionId).toBe('session-1')

    const onOpenSession = vi.fn(async () => true)
    await render(summary!, onOpenSession)
    const action = host.querySelector<HTMLButtonElement>('[data-open-session]')!
    expect(action).not.toBeNull()
    await act(async () => { action.click() })
    await act(async () => { await Promise.resolve() })
    // 点开的是**同一条**：id 一路从投影带到点击，中间没有第二份查找。
    expect(onOpenSession).toHaveBeenCalledWith({ sessionId: 'session-1', date: '2026-11-02', periodId: 'default', locale: 'zh-CN' })
  })

  it('renders no action and leaves no placeholder when the projection names no session', async () => {
    const [summary] = await briefingHistorySummaries({
      dates: ['2026-11-02'], primary: 'zh-CN', primaryRows: [storedEdition], otherRows: []
    })
    expect(summary?.sessionId).toBeUndefined()

    await render(summary!, async () => true)
    expect(host.querySelector('[data-open-session]')).toBeNull()
    // 行本身照旧：没有动作不等于这一行不在了。
    expect(host.querySelector('.mi-daily-briefing__rail-row')).not.toBeNull()
  })
})
