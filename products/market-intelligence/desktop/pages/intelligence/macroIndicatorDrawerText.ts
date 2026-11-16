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
      cpi: { title: 'CPI 年率', state: '11-10 已发布', unit: '同比', core: '核心年率', next: '下次发布', consensus: '预期' },
      payrolls: { title: '新增就业', state: '11-06 已发布', unit: '非农新增', unemployment: '失业率', next: '下次发布', consensus: '预期' },
      pce: { title: 'PCE 核心', state: '10-29 已发布', unit: '核心同比', next: '下次发布', consensus: '预期' }
    },
    cardStates: {
      notAvailable: '未提供',
      unreadable: '暂时读不到',
      /* 卡面只留字段和值：状态词说清「本期没有这个数」就够，原因进 ⓘ 浮层。 */
      missingCurrent: '{period} · 本期无此数',
      missingCurrentNoPeriod: '本期无此数',
      notRecorded: '本月未发布',
      previousPeriod: '上一期 {value}',
      /* 回退顺序落到哪一档，就把那一档的出处与期次写出来：不写的话，9 月的值挂在 10 月那格里。 */
      previousPeriodFrom: '上一期 {value}（{source} · {period}）',
      previousUnreadable: '上一期 暂时读不到',
      noConsensus: '暂无预期',
      consensusSource: '{source} · {asOf}',
      vsPrevious: '较上期（未修正）{value}'
    },
    /**
     * 距发布：>24 小时说整数天；≤24 小时才倒计时；**源只给日期时永远只说天数**（`today` 处理 0 天）。
     * 「已过」不设键——那一格直接不画，挂着「下次发布」说过去的事就是自相矛盾。
     */
    /**
     * 左卡「已发布」的时间标签（三档，深金）。**超过 3 天不渲染任何标签、整卡降权**——
     * 那条是「不渲染 + 类名」，不需要键。
     *
     * 取整与倒计时**相反**：倒计时是「还没到」，向上取整（不出现「还有 0 分」）；这里是「已经过了」，
     * 向下取整会把 59 秒说成「刚发布 0 分钟」，所以 <1 分钟统一写「刚发布 1 分钟」。
     */
    published: {
      minutes: '刚发布 {minutes} 分钟',
      hours: '刚发布 {hours} 小时',
      yesterday: '昨天发布',
      beforeYesterday: '前天发布',
      daysAgo: '{days} 天前'
    },
    /** 卡面骨架：期次与时刻、来源行、口径、预期差三态、折叠那句。 */
    cardFace: {
      whenPublished: '{period} · {time} 发布',
      whenNext: '下次发布 {period} · {date}',
      noSchedule: '下次发布 · 暂无排期',
      sourceLine: '来源 {source} · {time}',
      chipUp: '高于预期',
      chipDown: '低于预期',
      chipFlat: '符合预期',
      expectedMissing: '暂无预期',
      expectedState: '预期状态 {state}',
      approx: '约 {value}',
      volume: '成交量 {value}',
      observed: '观测 {time}',
      /* 只有官方序列的**观测日**、没有那次发布时用这句：不写「发布」，那天没有发布。 */
      updatedAt: '更新于 {date}',
      beforeRelease: '（发布前）',
      expectedAllMissing: '本期暂无预期（盘未开）',
      /* 还没读完 ≠ 没盘：这一档只在读数还在路上时用，读完就换成值或「暂无预期」。 */
      loading: '预期读取中',
      stateMarket: '有盘',
      stateProvider: '有预期',
      stateNoSchedule: '暂无排期'
    },
    /** 卡面骨架：期次与时刻、来源行、口径、预期差三态、折叠那句。 */
    /** 轮播的四个入口都要可访问名：两个箭头、两个圆点，另加一句组名。 */
    carousel: {
      prev: '查看已发布',
      next: '查看下次发布'
    },
    /** 三张卡共用的行名（左右两卡按同一顺序逐行对齐，行位不删、不折、不藏）。 */
    cardRows: {
      yoy: '年率',
      mom: '月率',
      coreYoy: '核心年率',
      coreMom: '核心月率',
      nonfarm: '非农',
      unemployment: '失业率',
      avgHourlyMom: '时薪月率',
      avgHourlyYoy: '时薪年率'
    },
    countdown: {
      days: '{days} 天后',
      today: '今天',
      hoursMinutes: '还有 {hours} 小时 {minutes} 分',
      minutes: '还有 {minutes} 分'
    },
    expectedDiff: '预期差 年率 {yoy} · 核心 {core}',
    // 来源按**真实 provider** 显示：写死一个名字等于替数据编出处。
    /* 官方序列的品牌名；旧源即将删除、不赋品牌名，Narwhal 用日历那份既有文案。 */
    sourceFred: 'FRED',
    minicalMonth: '{year} 年 {month} 月',
    minicalTitle: '发布日历',
    minicalLegend: { done: '已发布', todo: '待发布', today: '今天' },
    minicalTools: { prev: '上一个月', next: '下一个月', back: '回到本月', refresh: '刷新市场日历', configure: '配置日历', refreshing: '正在刷新…', refreshed: '已刷新' },
    minicalNoData: '暂无日程数据',
    // 角标：数的是「格子里没显示出来的条数」，不是「重要条数」——所以是 +N，不是「N 条重要」。
    minicalMore: '+{count}',
    minicalMoreAria: '还有 {count} 条未显示',
    missingCurrentWhy: '去年同月（2025-10）的 CPI 从未发布，这一期的同比没有分母，所以本期没有这个数。',
    missingCurrentWhyAria: '为什么本期没有这个数',
    previousLabel: '上一期',
    minicalUnavailable: '暂时读不到这个月的日程',
    mkDay: {
      summary: '与利率相关 {related} 条',
      /* 值级缺失（不是「读不到」也不是「没有序列」）：经济指标行有发布、源没给数。
         与 `market.missingValue`（'暂无'，服务前值/时刻缺失）不是一回事，**不许复用**。 */
      valueMissing: '未提供',
      /* 日详情顶部那句解释，只出现一次；右列每行已有行尾的 `未提供`，不重复。 */
      publishedWithoutValues: '已发布 · 来源未提供数值',
      other: '其他 {count} 条 · 均不影响利率预期',
      collapse: '收起 {count} 条 · 均不影响利率预期',
      none: '今天没有影响利率预期的事件',
      /* 自动跳到别的日子时必须说清：这是哪一天、为什么不是今天。 */
      notToday: '今天没有发布 · 下面是最近一个有发布的日子',
      sequence: '{name} · {index}/{total}',
      /* 「经济指标」组内的第二层：一级/二级/三级用指标码分级，没有码的（讲话、源内身份行）是「未分级」。 */
      tierGroup: '{tier} · {count} 条',
      tiers: { '1': '一级指标', '2': '二级指标', '3': '三级指标', other: '未分级' },
      /* 两个 tab（界面设计 2026-11-16）：条数进标签，**0 也显示 `(0)`**——tab 条是框架，
         不随当天数据变形，否则读者会以为功能没了。读不到时不带数字（数量未知，写 0 就是撒谎）。 */
      tabStandard: '标准表 ({count})',
      tabUnmapped: '未入标准表 ({count})',
      tabUnmappedUnknown: '未入标准表',
      tabsAria: '按来源切换当天事件',
      /* 未映射行上读屏补的一句；行内不写（视觉上已经在那个 tab 里了）。 */
      unmappedAria: '未入标准表',
      /* 空与读不到是两件事，句子必须能分开。 */
      unmappedEmpty: '这一天没有未入标准表的事件',
      unmappedEmptyNote: '标准表 {count} 条照常在左边那个 tab 里。',
      unmappedUnavailable: '未入标准表：这次读不到',
      unmappedUnavailableNote: '不是没有，是这次没读到。',
      /* 事件目录弹框（头部按钮打开）。范围写在标题里：全量读口到位之前如实写「本月」。 */
      repeatCount: '本期 {count} 次',
      /* 映射规则表（用户 2026-11-16：这里要看的是「源内 id ↔ 我们的指标码」，不是事件清单）。 */
      mappingTitle: '映射规则',
      mappingOpenAria: '打开映射规则表',
      mappingFilter: '按 id / 指标码 / 名字筛选',
      mappingTabMapped: '已映射 ({count})',
      mappingTabUnmapped: '未映射 ({count})',
      mappingTabsAria: '切换已映射与未映射',
      mappingMapped: '已映射 {count} 条',
      mappingUnmapped: '未映射 {count} 个 · 覆盖 {rows} 行',
      mappingMappedEmpty: '没有匹配的规则',
      mappingUnmappedEmpty: '没有匹配的 id',
      mappingUnavailable: '映射规则这次读不到',
      mappingColumns: { sourceId: '源内 id', metricKey: '指标码', name: '名称', periodRule: '期次规则', basis: '依据', official: '官方查看' },
      mappingUnmappedColumns: { sourceId: '源内 id', rows: '行数', sample: '样本名字' },
      catalogTitle: '全部事件',
      catalogOpenAria: '打开全部事件表',
      catalogNameFilter: '按名称筛选（中英均可）',
      catalogCountryFilter: '按国家筛选',
      catalogImportanceFilter: '按重要性筛选（high / medium / low）',
      catalogSourceLabelTag: '源原文名',
      catalogColumns: { name: '名称', country: '国家', period: '期间', date: '最近一次发布', next: '下次发布', time: '时刻', importance: '重要性' },
      catalogImportance: { high: '高', medium: '中', low: '低' },
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
      cpi: { title: 'CPI YoY', state: '11-10 published', unit: 'YoY', core: 'Core YoY', next: 'Next release', consensus: 'Expectation' },
      payrolls: { title: 'Payrolls', state: '11-06 published', unit: 'NFP change', unemployment: 'Unemployment', next: 'Next release', consensus: 'Expectation' },
      pce: { title: 'Core PCE', state: '10-29 published', unit: 'Core YoY', next: 'Next release', consensus: 'Expectation' }
    },
    cardStates: {
      notAvailable: 'Not available',
      unreadable: 'Not readable right now',
      missingCurrent: '{period} · no value for this period',
      missingCurrentNoPeriod: 'no value for this period',
      notRecorded: 'Not released this month',
      previousPeriod: 'Previous {value}',
      previousPeriodFrom: 'Previous {value} ({source} · {period})',
      previousUnreadable: 'Previous: not readable right now',
      noConsensus: 'No expectation',
      consensusSource: '{source} · {asOf}',
      vsPrevious: 'vs previous (unrevised) {value}'
    },
    expectedDiff: 'Surprise YoY {yoy} · core {core}',
    published: {
      minutes: 'Published {minutes} min ago',
      hours: 'Published {hours} h ago',
      yesterday: 'Published yesterday',
      beforeYesterday: 'Published the day before yesterday',
      daysAgo: '{days} days ago'
    },
    cardFace: {
      whenPublished: '{period} · published {time}',
      whenNext: 'Next release {period} · {date}',
      noSchedule: 'Next release · no schedule',
      sourceLine: 'Source {source} · {time}',
      chipUp: 'above expectation',
      chipDown: 'below expectation',
      chipFlat: 'in line',
      expectedMissing: 'No expectation',
      expectedState: 'Expectation status {state}',
      approx: 'about {value}',
      volume: 'Volume {value}',
      observed: 'observed {time}',
      updatedAt: 'Updated {date}',
      beforeRelease: '(before release)',
      expectedAllMissing: 'No expectation for this period (market not open)',
      /* Not yet read ≠ no market: only while the read is in flight. */
      loading: 'Reading expectations',
      stateMarket: 'Market open',
      stateProvider: 'Data provider',
      stateNoSchedule: 'No schedule'
    },
    carousel: {
      prev: 'View released',
      next: 'View next release'
    },
    cardRows: {
      yoy: 'YoY',
      mom: 'MoM',
      coreYoy: 'Core YoY',
      coreMom: 'Core MoM',
      nonfarm: 'Nonfarm',
      unemployment: 'Unemployment',
      avgHourlyMom: 'Avg hourly MoM',
      avgHourlyYoy: 'Avg hourly YoY'
    },
    countdown: {
      days: 'in {days} days',
      today: 'today',
      hoursMinutes: '{hours}h {minutes}m left',
      minutes: '{minutes}m left'
    },
    // 来源按**真实 provider** 显示：写死一个名字等于替数据编出处。
    /* 官方序列的品牌名；旧源即将删除、不赋品牌名，Narwhal 用日历那份既有文案。 */
    sourceFred: 'FRED',
    minicalMonth: '{month}/{year}',
    minicalTitle: 'release calendar',
    minicalLegend: { done: 'Published', todo: 'Scheduled', today: 'Today' },
    minicalTools: { prev: 'Previous month', next: 'Next month', back: 'This month', refresh: 'Refresh market calendar', configure: 'Configure calendar', refreshing: 'Refreshing…', refreshed: 'Refreshed' },
    minicalNoData: 'No calendar data yet',
    minicalMore: '+{count}',
    minicalMoreAria: '{count} more not shown',
    missingCurrentWhy: 'October 2025 CPI was never published, so this period has no year-over-year denominator.',
    missingCurrentWhyAria: 'Why this period has no value',
    previousLabel: 'Previous',
    minicalUnavailable: 'This month\'s schedule is not readable right now',
    mkDay: {
      summary: 'Related to rates {related}',
      valueMissing: 'Not provided',
      publishedWithoutValues: 'Published · the source gave no value',
      other: 'Other {count} · none move rate expectations',
      collapse: 'Collapse {count} · none move rate expectations',
      none: 'No events that move rate expectations today',
      notToday: 'Nothing released today · showing the most recent day with a release',
      sequence: '{name} · {index}/{total}',
      tierGroup: '{tier} · {count} events',
      tiers: { '1': 'Tier 1', '2': 'Tier 2', '3': 'Tier 3', other: 'Untiered' },
      tabStandard: 'Standard ({count})',
      tabUnmapped: 'Not mapped ({count})',
      tabUnmappedUnknown: 'Not mapped',
      tabsAria: 'Switch the day\'s events by source',
      unmappedAria: 'Not mapped',
      unmappedEmpty: 'No unmapped events on this day',
      unmappedEmptyNote: 'The {count} standard events are in the other tab.',
      unmappedUnavailable: 'Not mapped: not readable right now',
      unmappedUnavailableNote: 'Not empty — this read did not come back.',
      repeatCount: '{count} releases this period',
      mappingTitle: 'Mapping rules',
      mappingOpenAria: 'Open the mapping rules table',
      mappingFilter: 'Filter by id / metric key / name',
      mappingTabMapped: 'Mapped ({count})',
      mappingTabUnmapped: 'Unmapped ({count})',
      mappingTabsAria: 'Switch between mapped and unmapped',
      mappingMapped: '{count} mapped',
      mappingUnmapped: '{count} unmapped · {rows} rows',
      mappingMappedEmpty: 'No matching rules',
      mappingUnmappedEmpty: 'No matching ids',
      mappingUnavailable: 'Mapping rules are not readable right now',
      mappingColumns: { sourceId: 'Source id', metricKey: 'Metric key', name: 'Name', periodRule: 'Period rule', basis: 'Basis', official: 'Official' },
      mappingUnmappedColumns: { sourceId: 'Source id', rows: 'Rows', sample: 'Sample name' },
      catalogTitle: 'All events',
      catalogOpenAria: 'Open the full event table',
      catalogNameFilter: 'Filter by name (any language)',
      catalogCountryFilter: 'Filter by country',
      catalogImportanceFilter: 'Filter by importance (high / medium / low)',
      catalogSourceLabelTag: 'source label',
      catalogColumns: { name: 'Name', country: 'Country', period: 'Period', date: 'Latest release', next: 'Next release', time: 'Time', importance: 'Importance' },
      catalogImportance: { high: 'High', medium: 'Medium', low: 'Low' },
    },
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    surprise: { beat: 'Above forecast {value}', miss: 'Below forecast {value}', inline: 'In line' },
    dataBy: 'Data by',
    closeHint: 'Close'
  }
} as const

export type MacroIndicatorDrawerText = typeof macroIndicatorDrawerText['zh-CN'] | typeof macroIndicatorDrawerText['en-US']
