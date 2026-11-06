/** 已注册指标的显示名（九个），**唯一一份**：文案表与通知生产者都从这里取。
 *
 * 只覆盖带稳定标识（`eventNameKey`）的已注册指标；0xRouter 那条路的自由文本没有标识，
 * 用源站原文（中文界面出现英文指标名是已知欠账，见情报需求 §十二）。
 */
export const registeredEventNames = {
  'zh-CN': {
    cpi: '消费者物价指数（CPI）', 'core-cpi': '核心 CPI', 'nonfarm-payrolls': '非农就业人数',
    unemployment: '失业率', 'average-hourly-earnings': '平均时薪', pce: 'PCE 物价', 'core-pce': '核心 PCE',
    gdp: 'GDP', fomc: '美联储议息会议'
  },
  'en-US': {
    cpi: 'CPI', 'core-cpi': 'Core CPI', 'nonfarm-payrolls': 'Nonfarm payrolls',
    unemployment: 'Unemployment rate', 'average-hourly-earnings': 'Average hourly earnings', pce: 'PCE', 'core-pce': 'Core PCE',
    gdp: 'GDP', fomc: 'FOMC decision'
  }
} as const

export type RegisteredEventNameKey = keyof typeof registeredEventNames['zh-CN']
