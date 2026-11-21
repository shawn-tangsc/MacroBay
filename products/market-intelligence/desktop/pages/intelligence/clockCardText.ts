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
    /* 环上只放**一个**最重要的指标（用户 2026-11-21），其余全部在这行里，点 ⓘ 列全。 */
    overflowLine: '还有 {count} 个发布不在环上',
    /* 逐条：名字 · 日期 · 几天后；三样都写，读者才知道漏的是哪一条、还剩多久。 */
    overflowItem: '{name} · {date} · {days} 天后'
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
    overflowLine: '{count} more releases off the ring',
    overflowItem: '{name} · {date} · in {days} days'
  }
} as const
