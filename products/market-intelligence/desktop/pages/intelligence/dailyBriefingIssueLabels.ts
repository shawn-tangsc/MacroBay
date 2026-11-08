import type { BriefingMarketRow, BriefingPulseRow } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 一条限制说明里「这是哪一行 / 哪一项 / 哪个来源」的取名规则：把文档与设置里的内部 id 换成读者认得的词。
 *
 * 抽出来是因为它们是纯映射，且**所有** issue 模板都共用同一套名字——两处各写一份，读者就会在
 * 同一条清单里看到同一个来源两个叫法。这里不判「有没有问题」，只回答「叫什么」。
 */

/** 核心指标 id → 文案行键。没列出来的指标按原样落空，不猜同义词。 */
export const coreMetricRows: Readonly<Record<string, string>> = {
  'core-stablecoin-supply-usd': 'stablecoin',
  'etf-net-flow-btc': 'etfBtc',
  'etf-net-flow-eth': 'etfEth',
  'dxy-level': 'dxy',
  'gold-level-usd': 'gold',
  'us10y-yield-percent': 'us10y',
  'us10y-real-yield-percent': 'us10yReal'
}

export function coreMetricLabel(metric: string, text: DailyBriefingText): string {
  const key = coreMetricRows[metric]
  return key ? text.rows[key as keyof DailyBriefingText['rows']] ?? metric : ''
}

export function rowLabel(text: DailyBriefingText, labelKey: string): string {
  return text.rows[labelKey.split('.').pop() as keyof DailyBriefingText['rows']] ?? labelKey
}

export function rowSource(id: BriefingMarketRow['id'] | BriefingPulseRow['id'], text: DailyBriefingText): string {
  switch (id) {
    case 'stablecoin': return text.limits.sources.stablecoin
    case 'etf-btc':
    case 'etf-eth': return text.limits.sources.etf
    case 'fear-greed': return text.limits.sources.fearGreed
    case 'funding-btc':
    case 'funding-eth': return text.limits.sources.funding
    case 'dxy':
    case 'gold': return text.limits.sources.macro
    case 'us10y':
    case 'us10y-real': return text.limits.sources.rates
    default: return text.limits.sources.market
  }
}

export function eventTitle(item: Readonly<{ title: string; titleKey?: string }>, eventTitles: Record<string, string> | undefined): string {
  return eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title
}

/** 模板占位填充：`{event}` 这类键按 values 替换，缺值就原样留着（不印半句）。 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
