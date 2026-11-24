/** 宏观时钟卡的文案。文字内容取自原型，一字不改；只按语言分两份。 */
export const clockCardText = {
  'zh-CN': {
    ariaLabel: '宏观时钟卡',
    /* 牌上的指标缩写。 */
    names: {
      cpiYoy: 'CPI 年率', cpiMom: 'CPI 月率', coreCpiYoy: '核心 CPI 年率', coreCpiMom: '核心 CPI 月率',
      pceYoy: 'PCE 年率（季调）', pceMom: 'PCE 月率', corePceYoy: '核心 PCE 年率（季调）',
      corePceMom: '核心 PCE 月率', nonfarmPayrolls: '新增就业', unemploymentRate: '失业率',
      aheYoy: '平均时薪 年率', aheMom: '平均时薪（月率）', policyRate: '政策利率'
    },
    /* 主位第一行的全名（原型：中央写「非农新增就业」，环上那块写「新增就业」）。 */
    centerNames: { nonfarmPayrolls: '非农新增就业' },
    expectation: '预期（市场共识）',
    /* 政策利率那一格显示的是**盘口主推档的概率**，不是利率水平：名字必须说清楚，否则读者把 90.9% 当成利率。 */
    /* 主推档**会变**（这次加息、下次可能维持）：标签必须按主推档的名字生成，不能写死。
       标签格式：`政策利率 · {outcome}概率`。 */
    policyOutcomeLabel: '政策利率 · {outcome}概率',
    policyOutcomeNames: { 'no-change': '维持不变', 'hike-25': '加息 25bp', 'hike-50-plus': '加息 50bp 以上',
      'cut-25': '降息 25bp', 'cut-50-plus': '降息 50bp 以上' },
    expectationMissing: '预期未提供',
    previous: '前值',
    daysUntil: '{days} 天后',
    /* 过去牌的距离：与未来牌一样是「离现在多久」，只是方向相反。 */
    daysAgo: '{days} 天前',
    /* 当天发布不写「0 天后」（读着像没发生），写「今天」。 */
    today: '今天',
    now: '现在',
    live: '● 实时',
    detail: '详细 ↗',
    calendarAction: '打开日历',
    sourceNote: '来源 polymarket · 实时',
    unplaced: {
      'no-period': '读不到发布周期',
      'period-out-of-range': '发布周期不可信',
      'no-next-release': '没有下一期日程',
      crowded: '与更近的一项重叠'
    },
    unplacedLine: '{name} 未上环：{reason}',
    /* 政策块的两支降级：只在政策那一块表达，整张卡不降级（主位与另外三块牌照常显示）。 */
    policyDisabled: '政策利率未启用',
    policyUnreadable: '政策利率暂时读不到',
    openSources: '去启用数据源',
    crowdedLine: '{name} {days} 天后',
    crowdedLead: '另有 {count} 项未上环：{items}',
    crowdedMore: '另有 {count} 项',
    /* **每个发布日一块牌**（用户 2026-11-21）：同一天没被选为代表的那些在这行里，点 ⓘ 列全。 */
    /* ── 四支大类箭头（用户 2026-11 第三版）：环上只写这四个词 ──
       英文必须是 Rate / CPI / Jobs / PCE：Payrolls（41.4px）在 252 宽的卡上放不下。 */
    categories: { rate: '利率', cpi: 'CPI', payrolls: '非农', pce: 'PCE' },
    categoryAria: '{name}，{date} · {days} 天后',
    categoryNext: '{date} · {days} 天后',
    categoryEntry: '{name} {value} · {when}',
    categoryEntryNoValue: '{name} 未提供 · {when}',
    categoryEntryOdds: '{name} 概率 {value} · {when}',
    categoryScheduleUnreadable: '{name}：采集排期读不到',
    categoryNoRelease: '{name}：30 天内没有发布',
    categoryNameDemoted: '{name}：环上放不下名字，收在这里',
    shapeUnreadable: '暂时读不到',
    overflowLine: '还有 {count} 个发布不在环上',
    /* 逐条：名字 · 日期 · 几天后；三样都写，读者才知道漏的是哪一条、还剩多久。 */
    overflowItem: '{name} · {date} · {days} 天后',
    /* ── 中央两张面（用户 2026-11-21 拍板，42 号文件）──
       平时是利率路径面，只在发布前后各 24 小时内切成指标面。 */
    facePath: '利率路径',
    /* 档名：`12 月加息 25bp`。月份来自会议日，动作名按主推档生成——写死就会出错。 */
    policyOutcomeLead: '{month} 月{outcome}',
    meetingLine: '{date} · {days} 天',
    probabilityMissing: '概率暂未提供',
    pathUnreadable: '利率路径暂时读不到',
    pathDisabled: '利率路径未启用政策数据源',
    actualLabel: '实际',
    waitingResult: '等待发布结果',
    metricUnreadable: '{name}暂时读不到',
    expectationNotOpen: '暂无预期（盘未开）',
    pillHoursAgo: '{hours} 小时前',
    pillReleasesIn: '{hours} 小时后发布',
    pillOverdue: '已过 {hours} 小时',
    expectPrevShort: '预期 {expected} · 前值 {previous}',
    prevOnly: '前值 {previous}',
    deltaAbove: '{delta} 高于预期',
    deltaBelow: '{delta} 低于预期',
    retry: '再试',
    enableSource: '去启用'
  },
  'en-US': {
    ariaLabel: 'Macro clock card',
    names: {
      cpiYoy: 'CPI YoY', cpiMom: 'CPI MoM', coreCpiYoy: 'Core CPI YoY', coreCpiMom: 'Core CPI MoM',
      pceYoy: 'PCE YoY (SA)', pceMom: 'PCE MoM', corePceYoy: 'Core PCE YoY (SA)',
      corePceMom: 'Core PCE MoM', nonfarmPayrolls: 'Nonfarm Payrolls', unemploymentRate: 'Unemployment Rate',
      aheYoy: 'Avg Hourly Earnings YoY', aheMom: 'Avg Hourly Earnings', policyRate: 'Policy rate'
    },
    centerNames: { nonfarmPayrolls: 'Nonfarm payrolls' },
    expectation: 'Expected (market consensus)',
    policyOutcomeLabel: 'Policy rate · {outcome} probability',
    policyOutcomeNames: { 'no-change': 'no change', 'hike-25': 'hike 25bp', 'hike-50-plus': 'hike 50bp or more',
      'cut-25': 'cut 25bp', 'cut-50-plus': 'cut 50bp or more' },
    expectationMissing: 'Expectation unavailable',
    previous: 'Previous',
    daysUntil: 'In {days} days',
    daysAgo: '{days} days ago',
    today: 'Today',
    now: 'Now',
    live: '● Live',
    detail: 'Details ↗',
    calendarAction: 'Open calendar',
    sourceNote: 'Source polymarket · live',
    unplaced: {
      'no-period': 'release period unreadable',
      'period-out-of-range': 'release period not credible',
      'no-next-release': 'no upcoming release',
      crowded: 'overlaps a nearer one'
    },
    unplacedLine: '{name} not on the ring: {reason}',
    policyDisabled: 'Policy rate is not enabled',
    policyUnreadable: 'Policy rate cannot be read right now',
    openSources: 'Enable its data source',
    crowdedLine: '{name} in {days} days',
    crowdedLead: '{count} more not on the ring: {items}',
    crowdedMore: '{count} more',
    categories: { rate: 'Rate', cpi: 'CPI', payrolls: 'Jobs', pce: 'PCE' },
    categoryAria: '{name}, {date} · in {days} days',
    categoryNext: '{date} · in {days} days',
    categoryEntry: '{name} {value} · {when}',
    categoryEntryNoValue: '{name} n/a · {when}',
    categoryEntryOdds: '{name} {value} odds · {when}',
    categoryScheduleUnreadable: '{name}: schedule unreadable',
    categoryNoRelease: '{name}: nothing due within 30 days',
    categoryNameDemoted: '{name}: no room for the name, listed here',
    shapeUnreadable: 'Temporarily unreadable',
    overflowLine: '{count} more releases off the ring',
    overflowItem: '{name} · {date} · in {days} days',
    facePath: 'Policy path',
    policyOutcomeLead: '{month} · {outcome}',
    meetingLine: '{date} · {days} days',
    probabilityMissing: 'Probability unavailable',
    pathUnreadable: 'Policy path cannot be read right now',
    pathDisabled: 'Policy path has no data source enabled',
    actualLabel: 'Actual',
    waitingResult: 'Waiting for the result',
    metricUnreadable: '{name} cannot be read right now',
    expectationNotOpen: 'No expectation (market closed)',
    pillHoursAgo: '{hours}h ago',
    pillReleasesIn: 'Releases in {hours}h',
    pillOverdue: '{hours}h past due',
    expectPrevShort: 'Exp. {expected} · Prev. {previous}',
    prevOnly: 'Previous {previous}',
    deltaAbove: '{delta} above expected',
    deltaBelow: '{delta} below expected',
    retry: 'Retry',
    enableSource: 'Enable it'
  }
} as const
