/**
 * 事件类型：**源给的类型串 → 标准码 `evt.*`**（20 条，来自 22 号表）。
 *
 * 中文名只在 `marketCalendarCodeNames` 的事件名表里；本表只做「源串 → 码」的翻译。
 * 新增映射前**先贴源原文**（`name` 字段），不许照我们自己的说法写——那会多一条永远不命中的规则。
 */
export const eventCodeBySourceType: Readonly<Record<string, string>> = Object.freeze({
  'Central bank balance sheet': 'evt.central-bank-balance-sheet',
  'Central bank report': 'evt.central-bank-report',
  'Central bank speech': 'evt.central-bank-speech',
  'Commodity market report': 'evt.commodity-market-report',
  'Economic policy meeting': 'evt.economic-policy-meeting',
  'Employment statistics': 'evt.employment-statistics',
  'Fiscal report': 'evt.fiscal-report',
  'Futures positioning': 'evt.futures-positioning',
  'Household debt': 'evt.household-debt',
  'Merchandise trade': 'evt.merchandise-trade',
  'Monetary policy minutes': 'evt.monetary-policy-minutes',
  'Monetary policy press conference': 'evt.monetary-policy-press-conference',
  'Monetary policy projections': 'evt.monetary-policy-projections',
  'Monetary policy statement': 'evt.monetary-policy-statement',
  'Money and credit': 'evt.money-and-credit',
  'Mortgage applications': 'evt.mortgage-applications',
  'Oil rig count': 'evt.oil-rig-count',
  'Petroleum inventories': 'evt.petroleum-inventories',
  'Policy rate decision': 'evt.policy-rate-decision',
  'fomc（官方 event_name_key）': 'evt.fomc',
})
