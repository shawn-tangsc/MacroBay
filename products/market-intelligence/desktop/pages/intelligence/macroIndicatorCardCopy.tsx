import type { ReactElement, ReactNode } from 'react'
import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'

import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'
import type { EconomicCalendarText } from '../../features/macro/economic-calendar/economicCalendarText'
import type { MacroIndicatorCardFact } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'

/** 主值是「未提供 / 暂时读不到」时不占读数那档字号：那几个字一旦放大，会比真实数字更抢眼（界面设计定）。 */
export function cardValueClass(fact: MacroIndicatorCardFact | undefined, unreadable?: boolean): string | undefined {
  return !unreadable && fact?.state === 'provided' ? undefined : 'mk-card__na'
}

/**
 * 卡片页脚的数据来源：**按事实里真实的 provider 显示**。
 *
 * 原来这里写死「FRED」——而这条链路一次 FRED 都没调用过，那个标签是在替数据编出处。
 * 没有 provider（例如本期确实没有值）就**不写这一句**，不拿一个名字填空。
 */
export function cardSourceLabel(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, calendarText: EconomicCalendarText): ReactNode {
  const provider = fact?.source
  if (provider === 'fred') return <span>{text.sourceFred}</span>
  // Narwhal 用日历那份既有文案；旧源即将删除，不赋品牌名。
  return provider === 'narwhal' ? <span>{calendarText.market.source}</span> : null
}

/** 「上一期」的字段值：值 + 出处 · 期次（官方序列才有出处）；读不到写「暂时读不到」。 */
export function previousText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, timeZone: string): string | undefined {
  if (fact === undefined) return undefined
  if (fact.previousUnreadable === true) return text.cardStates.unreadable
  if (fact.previousAsPublished === undefined) return undefined
  const value = formatCardNumber(fact.previousAsPublished, fact.unit)
  if (fact.previousSource === 'fred' && fact.previousObservedAt !== undefined) {
    return text.cardStates.previousPeriodFrom
      .replace('{value}', value)
      .replace('{source}', text.sourceFred)
      .replace('{period}', formatCardPeriod(fact.previousObservedAt.slice(0, 7)))
  }
  return value
}

/** 卡头的 ⓘ：解释「为什么没有这个数」。卡面正文不放解释性句子。 */
export function CardWhy({ resolveKey }: Readonly<{ resolveKey: (key: string) => string }>): ReactElement {
  return <Popover
    labelKey="mk.cardWhy"
    resolveText={resolveKey}
    trigger={(triggerProps) => <IconButton {...triggerProps} ariaLabelKey="mk.cardWhyAria"
      icon={Info} size="sm" variant="plain" resolveText={resolveKey} />} />
}

/**
 * 「预期」一格：有共识就写值 + 出处与观测时刻（三样齐全才显示），没有就写「暂无共识」。
 * 不写「未提供」——那是「本期没值」，共识没有是另一件事。
 */
export function consensusText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, timeZone: string, nowInstant: string): string {
  const consensus = fact?.consensus
  if (consensus === undefined) return text.cardStates.noConsensus
  const day = calendarDisplayDate(consensus.asOf, timeZone)
  const short = day.slice(0, 4) === calendarDisplayDate(nowInstant, timeZone).slice(0, 4) ? day.slice(5) : day
  return `${formatCardNumber(consensus.value, fact?.unit)} · ${text.cardStates.consensusSource
    .replace('{source}', fact?.source === 'fred' ? text.sourceFred : '').replace('{asOf}', short)}`
    .replace(' ·  · ', ' · ')
}

/**
 * 主值三态分开写：
 * - 读到了 → 按单位写（percent 一位小数、thousands 带符号 K）；
 * - 读到了、这一期没值 → 「未提供」；
 * - **没读到** → 「暂时读不到」；还在读（没有事实、也没报失败）→ 空白，先不落一个字。
 */
export function cardValueText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, unreadable?: boolean): string {
  if (unreadable) return text.cardStates.unreadable
  if (fact === undefined) return ''
  if (fact.state === 'provided' && fact.value !== undefined) return formatCardNumber(fact.value, fact.unit)
  return text.cardStates.notAvailable
}

/**
 * 「较上期（未修正）」：只用**首发布**的上一期值。
 *
 * 来源当前的 `previous` 可能是修订值（非农首发布 29、修订后 60），拿它算会把 +136K 写成 +105K。
 * 缺首发布值就整块不显示这一行——不拿修订值顶，也不回填 0。
 */
export function cardChangeText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText): string | undefined {
  if (fact?.state !== 'provided' || fact.value === undefined || fact.previousAsPublished === undefined) return undefined
  const delta = fact.value - fact.previousAsPublished
  const signed = fact.unit === 'thousands'
    ? `${delta > 0 ? '+' : ''}${Math.round(delta)}K`
    : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}pp`
  return text.cardStates.vsPrevious.replace('{value}', signed)
}

/** 值级缺失时那一行：写清是哪一期、是「发布了没值」还是「本月没发布」；读不到时不写这一行。 */
export function cardStateText(fact: MacroIndicatorCardFact | undefined, text: MacroIndicatorDrawerText, unreadable?: boolean): string | undefined {
  if (unreadable || !fact || fact.state === 'provided') return undefined
  if (fact.state === 'not-recorded') return text.cardStates.notRecorded
  // 期次不知道时不许留一个悬空的「 · 」：那句话要能独立成立。
  const base = fact.period === undefined
    ? text.cardStates.missingCurrentNoPeriod
    : text.cardStates.missingCurrent.replace('{period}', formatCardPeriod(fact.period))
  // 卡面只写状态词；「上一期」是另一个字段，单独一行渲染。
  return base
}

export function formatCardNumber(value: number, unit: MacroIndicatorCardFact['unit']): string {
  if (unit === 'thousands') return `${value > 0 ? '+' : ''}${Math.round(value)}K`
  if (unit === 'percent') return `${value.toFixed(1)}%`
  // 两个源都没声明单位时不替它编一个：数字照写，不挂 `%` 也不挂 `K`。
  return String(value)
}

/** `2026-10` → `10 月`；别的形状原样返回（不猜）。 */
export function formatCardPeriod(period: string | undefined): string {
  const match = /^\d{4}-(\d{2})$/.exec(period ?? '')
  return match ? `${Number(match[1])} 月` : (period ?? '')
}
