import type { NotificationCopyParam } from '@platform/notifications/contracts/notificationCopyPort'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS, notificationEventNamedKey } from '../../../contracts/notificationEventKeys'
import { registeredEventNames } from '../../../contracts/registeredEventNames'

/**
 * 宏观事件落地通知的参数（情报需求 §十二）：**这里只装配参数，不写句子**。
 *
 * 三条硬规矩：
 * - **数值原样传**：`displayValue` 是源站写的串，可能 `3.1%`、`1.2M`、也可能 `3.4`；
 *   单位与精度我们不知道（`MarketCalendarValue` 只有 `displayValue`），自己拼必然出错。
 * - **国家走代码**：有表就用可翻引用，没有表就显示代码本身（`JP`），**不用源站 `countryName`、不许留空**。
 * - **指标名分两条路**：有 `eventNameKey` 且表里有 → 可翻引用；没有 → 用源站原文（已知欠账）。
 */

const EVENT_ID = EVENT_IDS.macroEventLanded

/**
 * 国家代码表只放**这条通知今天真的会出现**的国家：筛选写死了美国（`qualifyingCountryCode`），
 * 其余代码一律按代码本身显示（`JP`、`BR`）——留空或退回去用源站 `countryName` 都不许。
 */
export const TRANSLATED_COUNTRY_CODES = Object.freeze(['US'])

export type SurprisePeriodicity = 'yoy' | 'mom'

export type MacroEventLandingCopyInput = Readonly<{
  countryCode: string
  eventNameKey?: string
  /** 源站标题原文；没有稳定标识时直接上屏。 */
  title: string
  comparison: 'above' | 'below'
  periodicity?: SurprisePeriodicity
}>

/**
 * 从源站标题里认口径：同比 / 环比。
 *
 * **认不出就不写，不许猜**（情报需求 §十二之一）：`CPI (YoY)` / `CPI y/y` / `同比` 都算同比，
 * `MoM` / `环比` 算环比；其余一律 `undefined`，正文末尾就不带括号。
 */
export function recognizePeriodicity(title: string): SurprisePeriodicity | undefined {
  const text = title.toLowerCase()
  if (/yoy|y\/y|year[- ]over[- ]year|同比/.test(text)) return 'yoy'
  if (/mom|m\/m|month[- ]over[- ]month|环比/.test(text)) return 'mom'
  return undefined
}

function copyRef(path: string): NotificationCopyParam {
  return { ref: { scope: 'product', productId: 'market-intelligence', key: notificationEventNamedKey(EVENT_ID, path) } }
}

function knownIndicator(key: string | undefined): key is keyof typeof registeredEventNames['zh-CN'] {
  return key !== undefined && Object.hasOwn(registeredEventNames['zh-CN'], key)
}

/**
 * 标题三个槽：国家、指标、方向。
 *
 * 国家与方向永远是引用（可翻）；指标有稳定标识才用引用，否则用源站原文——原文是数据，
 * 本来就与语言无关，冻住它不算「冻住语言」。
 */
export function macroEventTitleParams(input: MacroEventLandingCopyInput): Readonly<Record<string, NotificationCopyParam>> {
  const country = TRANSLATED_COUNTRY_CODES.includes(input.countryCode)
    ? copyRef(`country.${input.countryCode}`)
    : input.countryCode
  const indicator = knownIndicator(input.eventNameKey) ? copyRef(`indicator.${input.eventNameKey}`) : input.title.trim()
  return {
    country,
    indicator,
    direction: copyRef(`direction.${input.comparison}`)
  }
}

/** 正文末尾的口径括号：认不出就是空串（模板里不加别的括号，避免出现 `（）`）。 */
export function macroEventPeriodLabel(periodicity: SurprisePeriodicity | undefined): NotificationCopyParam {
  return periodicity === undefined ? '' : copyRef(`periodicity.${periodicity}`)
}
