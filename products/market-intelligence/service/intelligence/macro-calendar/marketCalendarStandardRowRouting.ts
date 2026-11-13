import { eventCodeBySourceType } from './marketCalendarEventCodeTable'

/**
 * **一条发布怎么落**：唯一的路由判据，实时写入与回填都调它。
 *
 * 为什么必须只有一处：回填是第一版只写了指标行、漏掉事件型，79 条历史数据静默消失，
 * 读者看到的是一段空日历。只要两处各写一套「这类怎么落」，就一定会以「少一整类」的方式出错，
 * 而且不报错。
 *
 * 输入只要求「身份三段 + 有没有 period + 源名」，不要求 measure：measure 拆行是实时采集那层的事，
 * 回填没有那个输入。路由结果：
 * - `indicator`：有期间、有值 → 交给 measure 拆行（调用方负责）；
 * - `event`：没有期间，或源名能翻成 `evt.*`（含「有期间但无值」的兜底）；
 * - `source`：连事件码都没有 → 用源内身份，**照样显示**；
 * - `unmapped`：身份本身不成立（例如没有 period 且没有可用的源内 id）。
 */
export type StandardRowRoute =
  | Readonly<{ kind: 'indicator' }>
  | Readonly<{ kind: 'event'; metricKey: string }>
  | Readonly<{ kind: 'source' }>
  | Readonly<{ kind: 'unmapped'; reason: 'unknown-event-type' }>

export function routeStandardRelease(input: Readonly<{
  hasPeriod: boolean
  hasValues: boolean
  sourceName: string
}>): StandardRowRoute {
  if (input.hasPeriod && input.hasValues) return { kind: 'indicator' }
  const code = eventCodeBySourceType[input.sourceName]
  if (code !== undefined) return { kind: 'event', metricKey: code }
  // 没有事件码：有期间 → 源内身份（仍然显示）；没有期间 → 也走源内身份，身份不成立时才 unmapped。
  return input.hasPeriod ? { kind: 'source' } : { kind: 'source' }
}
