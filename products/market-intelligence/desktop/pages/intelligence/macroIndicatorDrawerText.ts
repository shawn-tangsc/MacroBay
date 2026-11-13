/**
 * The 关键指标 · 预期变化 drawer's copy.
 *
 * It lives beside the component, like `economicCalendarText.ts` does for the calendar page: the
 * product's own vocabulary stays in the product module, in both locales, so no visible sentence is
 * ever a literal inside JSX.
 *
 * 抽屉里每一块（曲线、政策卡、三张卡、迷你日历、右列当日事件）都读真数据，这张表里
 * 没有任何「示意数据」标记——那类标记撤掉之后不许再长回来。
 */
export const macroIndicatorDrawerText = {
  'zh-CN': {
    title: '关键指标 · 预期变化',
    open: '打开关键指标 · 预期变化',
    rateTitle: '利率数学期望',
    rateUnit: 'bp',
    rateNote: '纵轴＝加权期望（bp）· 零以上＝预期加息 / 零以下＝预期降息',
    rateNoteAria: '利率数学期望的说明',
    rateUnreadable: '暂时读不到',
    rateFlat: '持平 · 较上一日',
    rateNoHistory: '无历史可比',
    rateDeltaUp: '↑ +{value}bp · 较上一日',
    rateDeltaDown: '↓ −{value}bp · 较上一日',
    rateTruncated: '序列已截断，只画了最近 {days} 天',
    chartAria: '利率数学期望曲线：每个点是那一刻五档概率的加权期望，单位 bp',
    eventNames: {
      cpi: 'CPI 年率', coreCpi: '核心 CPI', payrolls: '新增就业', corePce: '核心 PCE',
      decision: '议息决议', minutes: '会议纪要'
    },
    panelExpectation: '加权期望',
    panelVsYesterday: '较上一日',
    panelFlat: '持平',
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
    cardStates: {
      notAvailable: '未提供',
      unreadable: '暂时读不到',
      missingCurrent: '{period} · 已到发布日期，首发布值未收录',
      missingCurrentNoPeriod: '已到发布日期，首发布值未收录',
      notRecorded: '本月未发布',
      previousPeriod: '上一期 {value}',
      vsPrevious: '较上期（未修正）{value}'
    },
    expectedDiff: '预期差 年率 {yoy} · 核心 {core}',
    source: 'FRED',
    sourceBls: 'BLS',
    detail: '详情 ↗',
    minicalMonth: '{year} 年 {month} 月',
    minicalTitle: '发布日历',
    minicalLegend: { done: '已发布', todo: '待发布', today: '今天' },
    minicalTools: { prev: '上一个月', next: '下一个月', back: '回到本月', refresh: '刷新市场日历', configure: '配置日历', refreshing: '正在刷新…', refreshed: '已刷新' },
    minicalNoData: '暂无日程数据',
    // 角标：数的是「格子里没显示出来的条数」，不是「重要条数」——所以是 +N，不是「N 条重要」。
    minicalMore: '+{count}',
    minicalMoreAria: '还有 {count} 条未显示',
    minicalUnavailable: '暂时读不到这个月的日程',
    mkDay: {
      summary: '与利率相关 {related} 条',
      other: '其他 {count} 条',
      collapse: '收起 {count} 条',
      none: '今天没有影响利率预期的事件',
      sequence: '{name} · {index}/{total}'
    },
    weekday: ['一', '二', '三', '四', '五', '六', '日'],
    surprise: { beat: '超预期 {value}', miss: '低于预期 {value}', inline: '符合预期' },
    dataBy: 'Data by',
    closeHint: '关闭'
  },
  'en-US': {
    title: 'Key indicators · expectations',
    open: 'Open key indicators · expectations',
    rateTitle: 'Rate expectation',
    rateUnit: 'bp',
    rateNote: 'Vertical axis = weighted expectation (bp) · above zero = a hike is priced, below = a cut',
    rateNoteAria: 'About the rate expectation',
    rateUnreadable: 'Not readable right now',
    rateFlat: 'Unchanged · vs yesterday',
    rateNoHistory: 'No earlier reading to compare',
    rateDeltaUp: '↑ +{value}bp · vs yesterday',
    rateDeltaDown: '↓ −{value}bp · vs yesterday',
    rateTruncated: 'Series truncated — only the last {days} days are drawn',
    chartAria: 'Rate expectation curve: each point is the five-bucket weighted expectation at that instant, in bp',
    eventNames: {
      cpi: 'CPI YoY', coreCpi: 'Core CPI', payrolls: 'Payrolls', corePce: 'Core PCE',
      decision: 'Rate decision', minutes: 'Meeting minutes'
    },
    panelExpectation: 'Weighted expectation',
    panelVsYesterday: 'vs yesterday',
    panelFlat: 'Unchanged',
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
    cardStates: {
      notAvailable: 'Not available',
      unreadable: 'Not readable right now',
      missingCurrent: '{period} · released, first-publish value not recorded',
      missingCurrentNoPeriod: 'released, first-publish value not recorded',
      notRecorded: 'Not released this month',
      previousPeriod: 'Previous {value}',
      vsPrevious: 'vs previous (unrevised) {value}'
    },
    expectedDiff: 'Surprise YoY {yoy} · core {core}',
    source: 'FRED',
    sourceBls: 'BLS',
    detail: 'Detail ↗',
    minicalMonth: '{month}/{year}',
    minicalTitle: 'release calendar',
    minicalLegend: { done: 'Published', todo: 'Scheduled', today: 'Today' },
    minicalTools: { prev: 'Previous month', next: 'Next month', back: 'This month', refresh: 'Refresh market calendar', configure: 'Configure calendar', refreshing: 'Refreshing…', refreshed: 'Refreshed' },
    minicalNoData: 'No calendar data yet',
    minicalMore: '+{count}',
    minicalMoreAria: '{count} more not shown',
    minicalUnavailable: 'This month\'s schedule is not readable right now',
    mkDay: {
      summary: 'Related to rates {related}',
      other: 'Other {count}',
      collapse: 'Collapse {count}',
      none: 'No events that move rate expectations today',
      sequence: '{name} · {index}/{total}'
    },
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    surprise: { beat: 'Above forecast {value}', miss: 'Below forecast {value}', inline: 'In line' },
    dataBy: 'Data by',
    closeHint: 'Close'
  }
} as const

export type MacroIndicatorDrawerText = typeof macroIndicatorDrawerText['zh-CN'] | typeof macroIndicatorDrawerText['en-US']
