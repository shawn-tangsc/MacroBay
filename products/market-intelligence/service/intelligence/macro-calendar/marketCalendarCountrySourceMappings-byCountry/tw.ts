import type { ZeroXRouterPeriodRule } from '../marketCalendarMetricIdentity'

/**
 * 按国家拆开的「源内 id → 码」映射（TW）。**数据型注册表，纯声明**：一行一个源内身份。
 *
 * 只收期次可定、测度一致的映射；目标码必须存在于码表（守卫在索引里断）。
 */
export const mapping_TW: Readonly<Record<string, Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  '213615': { metricKey: 'TW.MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'month' },
  '213718': { metricKey: 'TW.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },
  '213772': { metricKey: 'TW.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '213790': { metricKey: 'TW.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '213791': { metricKey: 'TW.MERCHANDISE_EXPORTS.NONE.YOY', periodRule: 'month' },
  '213792': { metricKey: 'TW.MERCHANDISE_IMPORTS.NONE.YOY', periodRule: 'month' },
  '214053': { metricKey: 'TW.EXPORT_ORDERS.NONE.YOY', periodRule: 'month' },
  '214140': { metricKey: 'TW.INDUSTRIAL_PRODUCTION.NONE.YOY', periodRule: 'month' },
  '214142': { metricKey: 'TW.M2_CURRENCY_TOTAL.NONE.YOY', periodRule: 'month' },
  '214329': { metricKey: 'TW.GDP.NONE.YOY', periodRule: 'month' },
  '214377': { metricKey: 'TW.MANUFACTURING_PURCHASING_MANAGERS.NONE.LEVEL', periodRule: 'month' },
  '214465': { metricKey: 'TW.CONSUMER_PRICE.NONE.YOY', periodRule: 'month' },
  '214466': { metricKey: 'TW.FOREIGN_EXCHANGE_RESERVES.NONE.AMOUNT', periodRule: 'month' },
  '214552': { metricKey: 'TW.TRADE_BALANCE.NONE.LEVEL', periodRule: 'month' },
  '214553': { metricKey: 'TW.MERCHANDISE_EXPORTS.NONE.YOY', periodRule: 'month' },
  '214554': { metricKey: 'TW.MERCHANDISE_IMPORTS.NONE.YOY', periodRule: 'month' },
  '214935': { metricKey: 'TW.EXPORT_ORDERS.NONE.YOY', periodRule: 'month' },
  '214954': { metricKey: 'TW.GDP.NONE.YOY', periodRule: 'month' },
  '214959': { metricKey: 'TW.M2_CURRENCY_TOTAL.NONE.YOY', periodRule: 'month' },
  '214980': { metricKey: 'TW.INDUSTRIAL_PRODUCTION.NONE.YOY', periodRule: 'month' },
})
