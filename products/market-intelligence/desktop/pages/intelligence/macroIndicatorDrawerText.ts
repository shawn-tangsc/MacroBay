/**
 * The 关键指标 · 预期变化 drawer's copy.
 *
 * It lives beside the component, like `economicCalendarText.ts` does for the calendar page: the
 * product's own vocabulary stays in the product module, in both locales, so no visible sentence is
 * ever a literal inside JSX.
 *
 * **This build is a static page.** Every value on screen is mock data; the drawer reads nothing.
 */
export const macroIndicatorDrawerText = {
  'zh-CN': {
    title: '关键指标 · 预期变化',
    open: '打开关键指标 · 预期变化',
    entry: { openAria: '打开关键指标 · 预期变化抽屉' },
    calendarLink: '经济日历',
    mockTag: '示意数据',
    rateTitle: '利率数学期望',
    rateUnit: 'bp',
    rateNote: '纵轴＝加权期望（bp）· 零以上＝预期加息 / 零以下＝预期降息',
    legendLine: '期望曲线',
    legendEvent: '事件推动',
    legendNoEvent: '无事件',
    eventsRail: '事件',
    policyRate: '政策利率',
    policyPending: '12-09 待发布',
    policyExpectation: '12 月加息 25bp',
    policyMix: { hike25: '加息 25', hike50: '加息 50+', other: '其余' },
    facts: {
      nextMeeting: '下次会议',
      range: '政策区间',
      sep: 'SEP 中位',
      lastVote: '上次票型'
    },
    cards: {
      cpi: { title: 'CPI 年率', state: '11-10 已发布', unit: '同比', core: '核心年率', next: '下次发布' },
      payrolls: { title: '新增就业', state: '11-06 已发布', unit: '非农新增', unemployment: '失业率', next: '下次发布' },
      pce: { title: 'PCE 核心', state: '10-29 已发布', unit: '核心同比', next: '下次发布' }
    },
    expectedDiff: '预期差 年率 {yoy} · 核心 {core}',
    source: 'FRED',
    sourceBls: 'BLS',
    detail: '详情 ↗',
    minicalMonth: '{year} 年 {month} 月',
    minicalTitle: '发布日历',
    minicalLegend: { done: '已发布', todo: '待发布', today: '今天' },
    minicalTools: { prev: '上一个月', next: '下一个月', back: '回到本月', refresh: '刷新市场日历', configure: '配置日历', refreshing: '正在刷新…', refreshed: '已刷新' },
    zoom: '曲线缩放',
    minicalEmpty: '这个月没有安排发布',
    weekday: ['一', '二', '三', '四', '五', '六', '日'],
    dayTitle: '{date} 的事件',
    daySummary: '当日共 {count} 条，已按类型分组',
    dayGroup: '{type} · {count} 条',
    dayEmpty: '这一天没有已收录的事件',
    more: '还有 {count} 条',
    kinds: { indicator: '经济指标', centralBank: '央行活动' },
    surprise: { beat: '超预期 {value}', miss: '低于预期 {value}', inline: '符合预期' },
    assets: { qqq: 'QQQ', btc: 'BTC', eth: 'ETH', usd: '美元' },
    dataBy: 'Data by',
    closeHint: '关闭'
  },
  'en-US': {
    title: 'Key indicators · expectations',
    open: 'Open key indicators · expectations',
    entry: { openAria: 'Open the key indicators and expectations drawer' },
    calendarLink: 'Economic calendar',
    mockTag: 'Sample data',
    rateTitle: 'Rate expectation',
    rateUnit: 'bp',
    rateNote: 'Vertical axis = weighted expectation (bp) · above zero = a hike is priced, below = a cut',
    legendLine: 'Expectation',
    legendEvent: 'Event impact',
    legendNoEvent: 'No event',
    eventsRail: 'Events',
    policyRate: 'Policy rate',
    policyPending: '12-09 scheduled',
    policyExpectation: 'A 25bp hike in December',
    policyMix: { hike25: 'Hike 25', hike50: 'Hike 50+', other: 'Other' },
    facts: { nextMeeting: 'Next meeting', range: 'Target range', sep: 'SEP median', lastVote: 'Last vote' },
    cards: {
      cpi: { title: 'CPI YoY', state: '11-10 published', unit: 'YoY', core: 'Core YoY', next: 'Next release' },
      payrolls: { title: 'Payrolls', state: '11-06 published', unit: 'NFP change', unemployment: 'Unemployment', next: 'Next release' },
      pce: { title: 'Core PCE', state: '10-29 published', unit: 'Core YoY', next: 'Next release' }
    },
    expectedDiff: 'Surprise YoY {yoy} · core {core}',
    source: 'FRED',
    sourceBls: 'BLS',
    detail: 'Detail ↗',
    minicalMonth: '{month}/{year}',
    minicalTitle: 'release calendar',
    minicalLegend: { done: 'Published', todo: 'Scheduled', today: 'Today' },
    minicalTools: { prev: 'Previous month', next: 'Next month', back: 'This month', refresh: 'Refresh market calendar', configure: 'Configure calendar', refreshing: 'Refreshing…', refreshed: 'Refreshed' },
    zoom: 'Chart zoom',
    minicalEmpty: 'No releases scheduled this month',
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    dayTitle: 'Events on {date}',
    daySummary: '{count} events, grouped by type',
    dayGroup: '{type} · {count}',
    dayEmpty: 'No events recorded for this day',
    more: '{count} more',
    kinds: { indicator: 'Economic indicators', centralBank: 'Central bank' },
    surprise: { beat: 'Above forecast {value}', miss: 'Below forecast {value}', inline: 'In line' },
    assets: { qqq: 'QQQ', btc: 'BTC', eth: 'ETH', usd: 'USD' },
    dataBy: 'Data by',
    closeHint: 'Close'
  }
} as const

export type MacroIndicatorDrawerText = typeof macroIndicatorDrawerText['zh-CN'] | typeof macroIndicatorDrawerText['en-US']
