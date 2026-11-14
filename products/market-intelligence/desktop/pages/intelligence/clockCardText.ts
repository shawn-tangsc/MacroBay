/** 宏观时钟卡的文案。文字内容取自原型，一字不改；只按语言分两份。 */
export const clockCardText = {
  'zh-CN': {
    ariaLabel: '宏观时钟卡',
    /* 牌上的指标缩写。 */
    names: { cpiYoy: 'CPI 年率', nonfarmPayrolls: '新增就业', policyRate: '政策利率' },
    /* 主位第一行的全名（原型：中央写「非农新增就业」，环上那块写「新增就业」）。 */
    centerNames: { nonfarmPayrolls: '非农新增就业' },
    expectation: '预期（市场共识）',
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
    crowdedLine: '{name} {days} 天后',
    crowdedLead: '另有 {count} 项未上环：{items}',
    crowdedMore: '另有 {count} 项'
  },
  'en-US': {
    ariaLabel: 'Macro clock card',
    names: { cpiYoy: 'CPI YoY', nonfarmPayrolls: 'Payrolls', policyRate: 'Policy rate' },
    centerNames: { nonfarmPayrolls: 'Nonfarm payrolls' },
    expectation: 'Expected (market consensus)',
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
    crowdedLine: '{name} in {days} days',
    crowdedLead: '{count} more not on the ring: {items}',
    crowdedMore: '{count} more'
  }
} as const
