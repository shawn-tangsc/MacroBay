// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'

const styles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css'), 'utf8')

/** 显示时区由窗口级 provider 提供；测试固定 UTC，断言才与宿主时区无关。 */
const scoped = (node: React.ReactElement): React.ReactElement => <ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider>
it('renders provider-only economic values and unknown country without numerical fields for other events', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const event = { eventKey: '00000000-0000-4000-8000-000000000001', title: 'Derived market event', countryCode: null,
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z',
    consensus: { displayValue: '0' }, providerPrevious: null, providerActual: { displayValue: '3' },
    source: 'Narwhal' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} text={text} />)))
    expect(host.textContent).toContain('市场预期')
    expect(host.textContent).toContain('公布值（Narwhal）')
    expect(host.textContent).toContain('未知国家')
    expect(host.textContent).toContain('暂不可比较')
    // 这条来源**给过**这条事件（有时间），所以不再说「本次尚未刷新」——时间与那句话不许自相矛盾。
    expect(host.textContent).not.toContain('本次尚未刷新')
    // 抽屉里没有 ⓘ，所以这里按 `full` 显示：常态串仍在，不是被搬走了。口径是「来源最后一次给出」，
    // 不是「我们采集于」——它证明对方还在给，不证明我们跑过。
    expect(host.textContent).toContain('来源最后一次给出这条于')
    expect(host.textContent).toContain('来源观测时间')
    expect(host.querySelector('[data-market-value="consensus"]')?.textContent).toContain('0')
    expect(host.querySelector('[data-market-value="providerPrevious"]')?.textContent).toBe('前值（Narwhal）暂无')
    expect(host.querySelector('[data-market-importance]')?.textContent).toBe('重要性高')
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...event, eventType: 'financial-event', consensus: null, providerPrevious: null, providerActual: null }} text={text} />)))
    expect(host.querySelector('[data-market-value]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
  })
it('states the market surprise in the inspector, and prints no number when there is none to compare', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000009', title: 'Surprise event', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-10-15T12:30:00.000Z',
    source: 'Narwhal' as const, sourceObservedAt: '2026-10-15T12:31:00.000Z', coverage: 'observed-unverified' as const }
  const surpriseRow = () => host.querySelector('[data-market-value="surprise"]')
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: { displayValue: '3.1%' }, providerPrevious: { displayValue: '3.1%' }, providerActual: { displayValue: '3.4%' } }} text={text} />)))
    expect(surpriseRow()?.getAttribute('data-surprise')).toBe('beat')
    expect(surpriseRow()?.querySelector('strong')?.textContent).toBe('超预期 +0.3 个百分点')

    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: null, providerPrevious: { displayValue: '3.1%' }, providerActual: { displayValue: '3.4%' } }} text={text} />)))
    expect(surpriseRow()?.getAttribute('data-surprise')).toBe('consensus-unavailable')
    expect(surpriseRow()?.querySelector('strong')?.textContent).toBe('无一致预期')
    expect(surpriseRow()?.querySelector('strong')?.textContent).not.toMatch(/[\d—−]/)

    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: { displayValue: '240K' }, providerPrevious: { displayValue: '240K' }, providerActual: { displayValue: '250K' } }} text={text} />)))
    expect(surpriseRow()?.getAttribute('data-surprise')).toBe('consensus-unavailable')
    expect(surpriseRow()?.querySelector('strong')?.textContent).toBe('预期差不可比')

    // A scheduled event has no actual, so it has no surprise row at all.
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base,
      consensus: { displayValue: '3.1%' }, providerPrevious: null, providerActual: null }} text={text} />)))
    expect(surpriseRow()).toBeNull()
  } finally { await act(async () => root.unmount()) }
})
it('prefers safe countryName, then code, then the localized unknown fallback', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000002', title: 'Country event', eventType: 'financial-event' as const,
    importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z', consensus: null, providerPrevious: null, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, countryCode: 'CHN', countryName: '中国' }} text={text} />)))
    expect(host.querySelector('[data-market-country]')?.textContent).toContain('中国')
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, countryCode: 'US' }} text={text} />)))
    expect(host.querySelector('[data-market-country]')?.textContent).toContain('US')
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, countryCode: null }} text={text} />)))
    expect(host.querySelector('[data-market-country]')?.textContent).toContain('未知国家')
  } finally { await act(async () => root.unmount()) }
})

it('shows the calendar times in the reader zone instead of a fixed Beijing offset', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const event = { eventKey: '00000000-0000-4000-8000-000000000003', title: 'Zoned event', countryCode: null,
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    // UTC provider：日历必须跟随窗口时区，而不是写死的 Asia/Shanghai
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} text={text} />)))
    expect(host.textContent).toContain('2026-09-10 00:00 GMT')
    expect(host.textContent).toContain('2026-09-10 01:00:00 GMT')
    await act(async () => root.render(<ShellTimeZoneProvider timeZone="Asia/Shanghai"><MarketCalendarInspector event={event} text={text} /></ShellTimeZoneProvider>))
    expect(host.textContent).toContain('2026-09-10 08:00 GMT+8')
    expect(host.textContent).toContain('2026-09-10 09:00:00 GMT+8')
  } finally { await act(async () => root.unmount()) }
})

it('renders safe failed and empty endpoint feedback in English without claiming live data', async () => {
  const { MarketCalendarSourceStatus } = await import('./MarketCalendarSourceStatus')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['en-US'].pages.intelligence.portal.calendar
  const time = '2026-09-14T00:00:00.000Z'
  try {
    await act(async () => root.render(scoped(<MarketCalendarSourceStatus text={text} source={{ eventType: 'economic-indicator',
      status: 'success', sourceObservedAt: time, latestAttempt: { state: 'failed', attemptedAt: '2026-09-20T00:00:00.000Z' } }} />)))
    expect(host.textContent).toContain('Refresh failed')
    expect(host.textContent).toContain('Showing previous data')
    expect(host.textContent).toContain('2026-09-14 00:00:00 GMT')
    await act(async () => root.render(scoped(<MarketCalendarSourceStatus text={text} source={{ eventType: 'financial-event',
      status: 'success-empty', sourceObservedAt: time }} />)))
    expect(host.textContent).toContain('No events this time')
    // 来源给过这一条（有时间）：不再说「本次尚未刷新」，否则与时间自相矛盾。
    expect(host.textContent).not.toContain('Not refreshed this session')
    expect(host.textContent).not.toContain('Refresh failed')
  } finally { await act(async () => root.unmount()) }
})

it('shows a refused automatic collection with its verdict and retained time in the body, origin in the info lines', async () => {
  const { MarketCalendarSourceStatus, calendarSourceStatusFragments } = await import('./MarketCalendarSourceStatus')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['en-US'].pages.intelligence.portal.calendar
  const observedAt = '2026-10-14T02:45:00.000Z'
  try {
    // `full`：抽屉里没有 ⓘ，这一行必须自带触发方式——它就是"这次的自动重试被拒"那句话。
    await act(async () => root.render(scoped(<MarketCalendarSourceStatus variant="full" text={text} source={{ eventType: 'economic-indicator',
      status: 'success', sourceObservedAt: observedAt, latestAttempt: { state: 'failed' as const,
        attemptedAt: '2026-10-14T13:00:00.000Z', failureCode: 'storage-pressure' as const, trigger: 'automatic' as const } }} />)))
    // Before this line existed, an automatic tick refused by the ceiling left no trace at all.
    expect(host.textContent).toContain('Refresh failed')
    expect(host.textContent).toContain('Storage limited')
    expect(host.textContent).toContain('Showing previous data')
    expect(host.textContent).toContain('2026-10-14 02:45:00 GMT')
    // 抽屉里没有 ⓘ：按 `full` 显示，所以触发方式仍在这一行里。
    expect(host.textContent).toContain('Automatic')
    const fragments = calendarSourceStatusFragments(
      { eventType: 'economic-indicator', status: 'success', sourceObservedAt: observedAt,
        latestAttempt: { state: 'failed', attemptedAt: '2026-10-14T13:00:00.000Z', failureCode: 'storage-pressure', trigger: 'automatic' } },
      text,
      (value) => value
    )
    expect(fragments.detail.join(' ')).toContain('Automatic')
    expect(fragments.body.join(' ')).not.toContain('Automatic')
    // The verdict is localised, never the raw wire code.
    expect(host.textContent).not.toContain('storage-pressure')

    await act(async () => root.render(scoped(<MarketCalendarSourceStatus variant="full" text={text} source={{ eventType: 'economic-indicator',
      status: 'success', sourceObservedAt: observedAt, latestAttempt: { state: 'failed', attemptedAt: '2026-10-14T13:00:00.000Z' } }} />)))
    expect(host.textContent).toContain('Refresh failed')
    expect(host.textContent).not.toContain('Storage limited')
  } finally { await act(async () => root.unmount()) }
})

it('gives the surprise row a coloured badge instead of plain value text', () => {
  expect(styles).toContain(".mi-economic-calendar__values [data-market-value='surprise'][data-surprise='beat'] strong")
  expect(styles).toContain(".mi-economic-calendar__values [data-market-value='surprise'][data-surprise='miss'] strong")
  expect(styles).toContain('var(--mi-economic-lime)')
  expect(styles).toContain('var(--danger)')
  expect(styles).toContain('font-weight: 700')
})

/**
 * 用户 2026-11-15：详情抽屉把一条 `importance` 为空的发布显示成「中」。
 *
 * 判据两半：必须写「未提供」（`market.missingValue`），且**不许出现**「中」——缺省不是「中等」，
 * 那是白天在卡片上刚修过的同一个形状，这里不能漏第二处。
 * 注意这条钉的是**渲染**：数据若是 medium 那是数据的事（写入端不许再拿 medium 占位），
 * 渲染层只负责「没有就不编」。
 */
it('says 未提供 for an event whose source gave no importance, never 中', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const event = { eventKey: '00000000-0000-4000-8000-0000000000aa', title: 'Empire State manufacturing survey', countryCode: 'US',
    eventType: 'economic-indicator' as const, scheduledAt: '2026-11-16T13:30:00.000Z',
    consensus: { displayValue: '10' }, providerPrevious: { displayValue: '25.5' }, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-11-13T13:20:07.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} text={text} />)))
    const row = host.querySelector('[data-market-importance]')
    expect(row?.textContent).toContain(text.market.missingValue)
    expect(row?.textContent).not.toContain('中')
    expect(host.textContent).not.toContain('重要性中')
  } finally {
    await act(async () => root.unmount()); host.remove()
  }
})

it('lists every schedule of a period that was released more than once', async () => {
  // 合并之后同一期可能发过多次（GDP 二读 11-25 / 三读 12-23）：只写合并后那一个，读者会把二读当初值。
  // 序号与时间都是事实；这里不写「初值/终值」——那是推断。
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const event = { eventKey: '00000000-0000-4000-8000-000000000002', title: 'GDP 年化', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-11-25T13:30:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null, source: '0xRouter' as const,
    sourceObservedAt: '2026-11-16T00:00:00.000Z', coverage: 'observed-unverified' as const,
    releaseDates: ['2026-11-25', '2026-12-23'] }
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} text={text} />)))
    const dates = [...host.querySelectorAll('[data-release-date]')].map((element) => element.textContent?.trim() ?? '')
    expect(dates).toHaveLength(2)
    // 「第 N 次」是那一期的第几次发布——只写日期读者不容易看出这是同一期的多次发布。
    expect(dates[0]).toContain('第 1 次')
    expect(dates[0]).toContain('2026-11-25')
    expect(dates[1]).toContain('第 2 次')
    expect(dates[1]).toContain('2026-12-23')
    // 只发过一次的事件不出现这份清单。
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...event, releaseDates: undefined }} text={text} />)))
    expect(host.querySelector('[data-release-dates]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

/**
 * 「事件内容」那一段：只用记录里已有的字段，**「没有」的两种来路不许写成同一句**。
 *
 * 用户 2026-11-13 定 #7（经济日历补事件内容），Chief 2026-11-16 划界：从现有字段取，取不到就
 * 如实显示，不许拿别的事件凑。这里钉三件事：
 * - 带了覆盖指标 → 列出来；
 * - 带了但是空数组 → 这条事件本来就不覆盖指标（讲话/会议）；
 * - 字段根本没带 → 源这一条没给（「源未给出」）。
 * 后两种都是「没有」，但来路不同；混成一句，读者分不清是源没给还是本来没有。
 */
it('names the indicators covered, and keeps the two ways of covering none apart', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const base = { eventKey: '00000000-0000-4000-8000-0000000000c1', title: 'CPI', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  const coverage = (): string => host.querySelector('[data-content-coverage]')?.textContent ?? ''
  const identity = (): string => host.querySelector('[data-content-identity]')?.textContent ?? ''
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector
      event={{ ...base, measureKeys: ['US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY'], eventNameKey: 'US.CPI.NSA.YOY' }} text={text} />)))
    expect(host.querySelector('[data-calendar-content]')?.textContent).toContain('事件内容')
    expect(coverage()).toContain('US.CPI.NSA.YOY')
    expect(coverage()).toContain('US.CORE_CPI.NSA.YOY')
    expect(identity()).toBe('事件标识US.CPI.NSA.YOY')

    // 源给了身份、但这条事件不覆盖指标（讲话类）→ 说「不覆盖」，不说「源未给出」。
    await act(async () => root.render(scoped(<MarketCalendarInspector
      event={{ ...base, eventType: 'central-bank-activity', measureKeys: [], seriesId: 'usa-speech' }} text={text} />)))
    expect(coverage()).toContain('这条事件不覆盖指标')
    expect(identity()).toBe('事件标识usa-speech')

    // 字段根本没带 → 源未给出；identity 也退到 seriesId，再没有才说源未给出。
    await act(async () => root.render(scoped(<MarketCalendarInspector event={base} text={text} />)))
    expect(coverage()).toContain('源未给出')
    expect(coverage()).not.toContain('不覆盖指标')
    expect(identity()).toContain('源未给出')
  } finally { await act(async () => root.unmount()) }
})

/**
 * 「这条源还在出数吗」——**按采集批次判，不按事件上的时刻判**。
 *
 * 用户 2026-11-16：Narwhal 自 11-13T13:20Z 起零产出，界面一路正常，直到读者拿着错的预期值
 * （10，实际 18）来问。判据在服务端算（`marketCalendarFeedLiveness`：连续错过 N 个自己的周期），
 * 这一条只钉**渲染**：停了就把「最后成功批次」写进正文；没停就一个字都不多。
 *
 * 为什么不拿事件上的 `sourceObservedAt` 判：它是「来源最后一次给出这一条」，翻到几年前的月份
 * 天然很旧，按它判会把每一个历史月份都写成「已停止出数」。批次回答的是另一个问题。
 */
it('says a source stopped producing, with the time of its last successful batch', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const event = { eventKey: '00000000-0000-4000-8000-0000000000f1', title: 'Empire State manufacturing survey',
    countryCode: 'US', eventType: 'economic-indicator' as const, importance: 'high' as const,
    scheduledAt: '2026-11-16T13:30:00.000Z', consensus: { displayValue: '10' }, providerPrevious: null,
    providerActual: { displayValue: '7.8' }, source: 'Narwhal' as const,
    sourceObservedAt: '2026-11-13T23:21:33.876Z', coverage: 'observed-unverified' as const }
  const silent = { eventType: 'economic-indicator' as const, status: 'success' as const,
    sourceObservedAt: '2026-11-13T23:21:33.876Z', lastBatchAt: '2026-11-13T13:20:07.915Z', collectorSilent: true }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={event} source={silent} text={text} />)))
    const status = host.querySelector('[data-market-source-status]')?.textContent ?? ''
    expect(status).toContain('已停止出数（最后 2026-11-13 13:20:07 GMT）')

    // 恢复一批 → 停止句消失（正常状态下这句一个字都不该出现）。
    await act(async () => root.render(scoped(<MarketCalendarInspector
      event={event} source={{ ...silent, lastBatchAt: '2026-11-16T13:50:00.000Z', collectorSilent: false }} text={text} />)))
    expect(host.querySelector('[data-market-source-status]')?.textContent).not.toContain('已停止出数')
  } finally { await act(async () => root.unmount()) }
})

/**
 * 「指标层级」那一行（用户 2026-11-17）：子项说清属于谁、母项列出分项。
 * 名字由服务端从层级表给，这里只验**渲染**：缺这一段整行不画，不出现空标签。
 */
it('shows the indicator level for a child and for a parent, and no row when there is none', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000021', title: '费城联储制造业装船指数', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-11-16T13:30:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-11-16T14:00:00.000Z', coverage: 'observed-unverified' as const }
  const row = () => host.querySelector('[data-content-hierarchy]')
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector text={text}
      event={{ ...base, hierarchy: { kind: 'child' as const, parentName: '费城联储制造业指数' } }} />)))
    expect(row()?.textContent).toBe('指标层级所属指标：费城联储制造业指数')

    await act(async () => root.render(scoped(<MarketCalendarInspector text={text}
      event={{ ...base, hierarchy: { kind: 'parent' as const,
        childNames: ['费城联储制造业装船', '费城联储制造业新订单'] } }} />)))
    expect(row()?.textContent).toBe('指标层级分项：费城联储制造业装船、费城联储制造业新订单')

    // 普通指标没有这一层：整行不画，不留一个空标签。
    await act(async () => root.render(scoped(<MarketCalendarInspector text={text} event={base} />)))
    expect(row()).toBeNull()
    // 子项但缺母名（半份数据）：也不画，不写「所属指标：源未给出」占位。
    await act(async () => root.render(scoped(<MarketCalendarInspector text={text}
      event={{ ...base, hierarchy: { kind: 'child' as const } }} />)))
    expect(row()).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

/**
 * #47 的接线判据（用户 2026-11-17）：详情里**按来源分块**，帝国大厦那期两边各写什么并排看；
 * 没有指标身份或没有期次时**不读、不画**——空块比没有块更容易被误解。
 */
it('asks for the per-source writes only when it has both identity and period, and renders them apart', async () => {
  vi.resetModules()
  const calls: { metricKey: string; scheduledDate: string }[] = []
  vi.doMock('../../../shared/ipc/marketCalendarClient', () => ({
    marketCalendarClient: {
      queryEventSourceWrites: async (input: { metricKey: string; scheduledDate: string }) => {
        calls.push(input)
        return { state: 'available' as const, metricKey: input.metricKey, providerCount: 2, hasRevisionChain: false,
          rows: [
            { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-16T21:49:41.793Z',
              status: 'backfilling', consensus: '10', actual: null, previous: '25.5', identityKey: input.metricKey,
              periodKey: '2026-11' },
            { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-16T13:30:00.000Z',
              status: 'published', consensus: '18.0', actual: '7.8', previous: '25.5', identityKey: '["214790",79095]',
              periodKey: '2026-11-16T13:30' }
          ] }
      }
    }
  }))
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const textZh = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000031', title: '帝国大厦制造业指数', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-11-16T13:30:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-11-16T14:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector text={textZh}
      event={{ ...base, eventNameKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' }} />)))
    await act(async () => { await Promise.resolve() })
    // 入参必须带期次（不带就会读回这个指标的所有月份）。
    expect(calls).toEqual([{ metricKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL', scheduledDate: '2026-11-16' }])
    const blocks = [...host.querySelectorAll('[data-source-block]')]
    expect(blocks.map((block) => block.getAttribute('data-source-block'))).toEqual(['narwhal', '0xrouter'])
    expect(blocks[0]!.textContent).toContain('10')
    expect(blocks[1]!.textContent).toContain('7.8')

    // 没有指标身份：不读、不画。
    calls.length = 0
    await act(async () => root.render(scoped(<MarketCalendarInspector text={textZh} event={base} />)))
    expect(calls).toHaveLength(0)
    expect(host.querySelector('[data-source-writes]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    vi.doUnmock('../../../shared/ipc/marketCalendarClient')
    vi.resetModules()
  }
})

/**
 * 产品口径（Chief 2026-11-17）：**预期有两个不同值时，差异句整句不出现**——同一个实际值落在两个
 * 预期之间时，「高于/低于」的符号会翻转。判据是「预期是否唯一」，不是「这次碰巧同向」。
 */
it('drops the surprise sentence when the sources disagree on consensus', async () => {
  vi.resetModules()
  vi.doMock('../../../shared/ipc/marketCalendarClient', () => ({
    marketCalendarClient: {
      queryEventSourceWrites: async (input: { metricKey: string }) => ({
        state: 'available' as const, metricKey: input.metricKey, providerCount: 2, hasRevisionChain: false,
        rows: [
          { source: 'observation' as const, providerId: 'narwhal', observedAt: '2026-11-16T21:49:41.793Z',
            status: 'backfilling', consensus: '10', actual: null, previous: '25.5', identityKey: input.metricKey,
            periodKey: '2026-11' },
          { source: 'observation' as const, providerId: '0xrouter', observedAt: '2026-11-16T13:30:00.000Z',
            status: 'published', consensus: '18.0', actual: '7.8', previous: '25.5', identityKey: input.metricKey,
            periodKey: '2026-11-16T13:30' }
        ]
      })
    }
  }))
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  const textZh = productText['zh-CN'].pages.intelligence.portal.calendar
  const base = { eventKey: '00000000-0000-4000-8000-000000000041', title: '帝国大厦制造业指数', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-11-16T13:30:00.000Z',
    consensus: { displayValue: '10' }, providerPrevious: { displayValue: '25.5' }, providerActual: { displayValue: '7.8' },
    source: 'Narwhal' as const, sourceObservedAt: '2026-11-16T14:00:00.000Z', coverage: 'observed-unverified' as const }
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector text={textZh}
      event={{ ...base, eventNameKey: 'US.EMPIRE_STATE_MANUFACTURING.SA.LEVEL' }} />)))
    await act(async () => { await Promise.resolve() })
    const surprise = host.querySelector('[data-market-value="surprise"]')!
    // 不是「低于预期」这种句子：预期不唯一，比较本身没有定义。
    expect(surprise.getAttribute('data-multi-consensus')).toBe('true')
    expect(surprise.textContent).not.toContain('低于')
    expect(surprise.textContent).not.toContain('高于')
    expect(surprise.textContent).toContain('暂不比较')
  } finally {
    await act(async () => root.unmount())
    vi.doUnmock('../../../shared/ipc/marketCalendarClient')
    vi.resetModules()
  }
})

/**
 * 官网（用户 2026-11-19）：详情抽屉里要能看到这一条的官网链接。
 *
 * 三态不许混：有地址 → 可点外链；有码待核 → 「待核」不可点；**没有码** → 明说没有对应指标码。
 * 数据来自码表，与映射规则表「官网页」同一份、同一个解析函数。
 */
it('shows the official site for the row, and keeps 待核 apart from 没有指标码', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const text = productText['zh-CN'].pages.intelligence.portal.calendar
  const host = document.createElement('div'); const root = createRoot(host)
  const base = { eventKey: '00000000-0000-4000-8000-0000000000c2', title: 'CPI', countryCode: 'US',
    eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-09-10T00:00:00.000Z',
    consensus: null, providerPrevious: null, providerActual: null,
    source: 'Narwhal' as const, sourceObservedAt: '2026-09-10T01:00:00.000Z', coverage: 'observed-unverified' as const }
  const officialRow = (): HTMLElement | null => host.querySelector('[data-content-official]')
  try {
    // ① 有码、有地址：可点外链，地址就是码表登记的那一个。
    await act(async () => root.render(scoped(<MarketCalendarInspector
      event={{ ...base, eventNameKey: 'US.CPI.NSA.YOY' }} text={text} />)))
    const link = officialRow()!.querySelector('a[data-official-link]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://www.bls.gov/news.release/')
    expect(link.getAttribute('target')).toBe('_blank')
    // ④ 读屏名写全：机构 + 完整地址。
    expect(link.getAttribute('aria-label')).toBe('BLS · https://www.bls.gov/news.release/')
    expect(officialRow()!.textContent).toContain('BLS · https://www.bls.gov/news.release/')

    // ② 有码、地址待核：写「待核」，且**没有链接**。
    await act(async () => root.render(scoped(<MarketCalendarInspector
      event={{ ...base, eventNameKey: 'BR.OVERNIGHT.NONE.LEVEL' }} text={text} />)))
    expect(officialRow()!.getAttribute('data-content-official')).toBe('pending')
    expect(officialRow()!.textContent).toContain('待核')
    expect(officialRow()!.querySelector('a')).toBeNull()

    // ③ 没有指标码：明说没有码，**不写「待核」**（待核=有码还没核）。
    await act(async () => root.render(scoped(<MarketCalendarInspector event={base} text={text} />)))
    expect(officialRow()!.getAttribute('data-content-official')).toBe('none')
    expect(officialRow()!.textContent).toContain('没有对应指标码')
    expect(officialRow()!.textContent).not.toContain('待核')
  } finally { await act(async () => root.unmount()) }
})
