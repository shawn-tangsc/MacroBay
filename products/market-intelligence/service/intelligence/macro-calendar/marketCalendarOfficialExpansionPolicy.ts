import { macroCalendarReleaseValueMappings } from './macroCalendarReleaseValueMappingPolicy'
import { marketCalendarReleaseGroupByMetricKey } from './marketCalendarReleaseGroups'

/**
 * 官方一次发布**按发布组展开**：BLS 一次公布「非农/失业率/时薪…」，那是一组身份共享同一个日期，
 * 不该只写「这次给了值的那一个码」。
 *
 * 两条边界：
 * 1. **排除清单落在码上，不按名字过滤**——同一次发布里已经出了年率和月率，价格指数那一格没有
 *    读者看；多一行「CPI 指数」会让读者以为同一件事有三条。
 * 2. 只有**拿到值的那一个码**带值，展开出来的兄弟码**一律值空**（它们今天没有值，不是我们算的）。
 */
export const officialExpansionPolicy = Object.freeze({
  /**
   * 不单独成行的码：价格指数水平（CPI / 核心 CPI，将来的 PCE 指数水平同族同理）。
   * 这些码随旧源退役一起删——留着就是「有码无生产者」。
   */
  excludedMetricKeys: Object.freeze(['US.CPI.NSA.LEVEL', 'US.CORE_CPI.SA.LEVEL'] as const)
})

/** 这条官方发布应当落成的**全部指标码**（含自己），组内展开、去掉排除清单。 */
export function officialExpansionMetricKeys(metricKey: string): readonly string[] {
  const group = marketCalendarReleaseGroupByMetricKey[metricKey]
  if (group === undefined) return [metricKey]
  const siblings = Object.entries(marketCalendarReleaseGroupByMetricKey)
    .filter(([, candidate]) => candidate === group)
    .map(([code]) => code)
  const excluded = new Set<string>(officialExpansionPolicy.excludedMetricKeys)
  return [metricKey, ...siblings.filter((code) => code !== metricKey)]
    .filter((code) => !excluded.has(code))
}

/** 官方发布键能对上哪个标准码（复用那 8 行发布映射；拼不出就不展开）。 */
export function officialMetricKeyOfEvent(eventKey: string): string | undefined {
  const mapping = macroCalendarReleaseValueMappings.find((row) => eventKey.startsWith(row.eventKeyPrefix))
  return mapping?.metricKey
}
