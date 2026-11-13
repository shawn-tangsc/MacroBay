/**
 * 事件类型：**源给的类型串 → 标准码 `evt.*`**。
 *
 * 出处：`docs-private/iterations/0.4.4-calendar-sources/22-源类型串到码.csv`（16 条）。
 * 中文名只在 20 号四列名表里；本表只做「源串 → 码」的翻译，**不含任何显示文案**——
 * 两个地方各写一份中文名，就是「两张名称表并存」，今晚已经因为这类重叠返工过。
 *
 * 未知类型串 → **不映射**，落 `unknown-event-type` 并计数；补一条就重放，不猜、不模糊匹配。
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
  'Monetary policy press conference': 'evt.monetary-policy-press-conference',
  'Monetary policy statement': 'evt.monetary-policy-statement',
  'Money and credit': 'evt.money-and-credit',
  'Mortgage applications': 'evt.mortgage-applications',
  'Oil rig count': 'evt.oil-rig-count',
  'Petroleum inventories': 'evt.petroleum-inventories',
})
