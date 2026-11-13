/**
 * 指标分级（`tier`）：**从 19 号表落成的代码常量**，唯一维护处就是那张表。
 *
 * 三级含义（`07-指标清单.md`）：一级 = 直接影响利率预期；二级 = 需要看但要挑；三级 = 背景。
 * 表里的 `4` 是「未分级」，**不写进这张常量**——缺席就是未分级，不拿一个档位去顶。
 *
 * 三条用法约束（架构师写进规范 §2.5，这里只留代码侧要点）：
 * 1. **只决定「谁不许被挤掉」**：一级进必进候选池，不受组内上限约束；进不进事实仍看有没有值、有没有变化；
 * 2. **不进 `importance`**：那是源给的（high/medium/low），这是我们自己判的影响档，两个维度不许互相覆盖；
 * 3. **一级缺失必须显式上报**，而且「该期还没到」与「读不到」分开写。
 *
 * 另有一条跨域事实：07 号表的「一级 5 项」在日历域只有 3 项、12 个码（CPI 4 + 就业 4 + PCE 4）。
 * 第 ① 项（利率与目标区间）在政策卡、第 ⑤ 项（10Y 实际收益率）在利率链——**它们缺数据时，
 * 日历一行都不会少**，所以「一级齐全」不能只看日历。
 */
export const marketCalendarTierByMetricKey: Readonly<Record<string, 1 | 2 | 3>> = Object.freeze({
  'US.AHE.NSA.YOY': 1,
  'US.AHE.SA.MOM': 1,
  'US.CORE_CPI.NSA.YOY': 1,
  'US.CORE_CPI.SA.MOM': 1,
  'US.CORE_PCE.NSA.YOY': 1,
  'US.CORE_PCE.SA.MOM': 1,
  'US.CPI.NSA.YOY': 1,
  'US.CPI.SA.MOM': 1,
  'US.NONFARM.SA.CHANGE': 1,
  'US.PCE.NSA.YOY': 1,
  'US.PCE.SA.MOM': 1,
  'US.UNEMPLOYMENT.SA.RATE': 1,
  'US.GDP.SA.ANNUALIZED_QOQ': 2,
  'US.GDP_NOWCAST.SA.ANNUALIZED_QOQ': 2,
  'US.INFLATION_EXPECTATIONS.NONE.LEVEL': 2,
  'US.ISM_MANUFACTURING.SA.LEVEL': 2,
  'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL': 2,
  'US.ISM_MANUFACTURING_INVENTORIES.SA.LEVEL': 2,
  'US.ISM_MANUFACTURING_NEW_ORDERS.SA.LEVEL': 2,
  'US.ISM_MANUFACTURING_PRICES.SA.LEVEL': 2,
  'US.ISM_MANUFACTURING_PRODUCTION.SA.LEVEL': 2,
  'US.ISM_SERVICES.SA.LEVEL': 2,
  'US.ISM_SERVICES_BUSINESS_ACTIVITY.SA.LEVEL': 2,
  'US.ISM_SERVICES_EMPLOYMENT.SA.LEVEL': 2,
  'US.ISM_SERVICES_INVENTORIES.SA.LEVEL': 2,
  'US.ISM_SERVICES_NEW_ORDERS.SA.LEVEL': 2,
  'US.ISM_SERVICES_PRICES.SA.LEVEL': 2,
  'US.ISM_SERVICES_SUPPLIER_DELIVERIES.SA.LEVEL': 2,
  'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE': 2,
  'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT': 2,
  'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT': 2,
  'US.MICHIGAN_CURRENT.NONE.LEVEL': 2,
  'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL': 2,
  'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL': 2,
  'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL': 2,
  'US.MICHIGAN_SENTIMENT.NONE.LEVEL': 2,
  'US.RETAIL_SALES.NSA.YOY': 2,
  'US.RETAIL_SALES.SA.MOM': 2,
  'US.RETAIL_SALES_CONTROL_GROUP.SA.MOM': 2,
  'US.RETAIL_SALES_EX_AUTOS.SA.MOM': 2,
  'US.RETAIL_SALES_EX_GAS_AUTOS.SA.MOM': 2,
})

/** 一个码的分级；没标就是「未分级」（返回 `undefined`，不返回 4）。 */
export function tierOfMetricKey(metricKey: string): 1 | 2 | 3 | undefined {
  return marketCalendarTierByMetricKey[metricKey]
}

/** 一级码集合：配额与缺口检查用它，别在调用点各自写一份。 */
export const marketCalendarTier1MetricKeys: readonly string[] = Object.freeze(
  Object.entries(marketCalendarTierByMetricKey).filter(([, tier]) => tier === 1).map(([code]) => code))
