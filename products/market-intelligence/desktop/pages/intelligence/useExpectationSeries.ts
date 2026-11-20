import { useMemo } from 'react'

import { metricConceptOf } from '../../../contracts/metricKeyConcept'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import {
  expectationBp, expectationEventMoves, matchedRelevantConcept
} from '../../../contracts/policyPath'
import type { ExpectationPoint } from './ExpectationChart'
import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * 期望曲线的输入：**只吃读数与事件**，与容器宽高无关。
 *
 * 抽屉与看板首页两处都要这张图，曲线公式只有一条（契约 `expectationBp`）、事件标注规则也只有一条
 * （`expectationEventMoves`：±15 分钟窗口、同窗不归因、最多 5 条）。这里把「序列 → 点」与
 * 「事件 → 短名标注」搬出来，两处共用同一份，不在各自文件里再写一遍。
 */
export type ExpectationSeriesEvent = Readonly<{
  at: string; label: string; eventNameKey?: string; measureKeys?: readonly string[]; seriesId?: string
}>

export type ExpectationSeries = Readonly<{
  points: readonly ExpectationPoint[]
  latestBp?: number
  /** 24 小时变化（bp）；`undefined` = 没有可比的历史，不是 0。 */
  delta?: number
  /** 序列被截断时覆盖的天数。 */
  truncatedDays?: number
  eventMarks: ReturnType<typeof expectationEventMoves>
}>

export function useExpectationSeries(
  policyReading: PolicyPathReading | undefined,
  releaseEvents: readonly ExpectationSeriesEvent[] | undefined,
  text: MacroIndicatorDrawerText
): ExpectationSeries {
  const points = useMemo<readonly ExpectationPoint[]>(() => {
    const series = policyReading?.probability?.series
    if (!series) return []
    return series.flatMap((point) => {
      const bp = expectationBp(point.values)
      return Number.isFinite(bp) ? [{ at: point.at, bp, values: point.values }] : []
    })
  }, [policyReading])
  const eventMarks = useMemo(() => {
    const series = policyReading?.probability?.series
    if (!series || !releaseEvents?.length) return []
    const named = releaseEvents.map((event) => ({ ...event, label: shortEventLabel(event, text) }))
    return expectationEventMoves(series, named)
  }, [policyReading, releaseEvents, text])
  const truncatedDays = policyReading?.probability?.seriesTruncated && points.length > 1
    ? Math.max(1, Math.ceil((Date.parse(points[points.length - 1]!.at) - Date.parse(points[0]!.at)) / 86_400_000))
    : undefined
  return {
    points,
    ...(points[points.length - 1]?.bp === undefined ? {} : { latestBp: points[points.length - 1]!.bp }),
    ...(policyReading?.probability?.expectationChange24hBp === undefined ? {} : { delta: policyReading.probability.expectationChange24hBp }),
    ...(truncatedDays === undefined ? {} : { truncatedDays }),
    eventMarks
  }
}

/** 图上用短名（完整标题不上图）；名字按身份取，不按标题文本猜。 */
export function shortEventLabel(
  event: Readonly<{ label: string; eventNameKey?: string; measureKeys?: readonly string[]; seriesId?: string }>,
  text: MacroIndicatorDrawerText
): string {
  if (event.seriesId === 'usa-policy-rate-decision') return text.eventNames.decision
  if (event.seriesId === 'usa-monetary-policy-minutes') return text.eventNames.minutes
  const matched = matchedRelevantConcept({ at: '', label: event.label, ...(event.measureKeys ? { measureKeys: event.measureKeys } : {}) })
  return nameOfMetricKey(matched ?? event.eventNameKey, text) ?? event.label
}

/** 事件短名按**概念**取（季调/未季调是同一个概念的两个变体），加变体不用改这里。 */
const eventNameKeyByConcept: Readonly<Record<string, 'cpi' | 'coreCpi' | 'payrolls' | 'corePce'>> = Object.freeze({
  'US.CPI.YOY': 'cpi',
  'US.CORE_CPI.YOY': 'coreCpi',
  'US.NONFARM.CHANGE': 'payrolls',
  'US.CORE_PCE.YOY': 'corePce'
})

function nameOfMetricKey(metricKey: string | undefined, text: MacroIndicatorDrawerText): string | undefined {
  if (metricKey === undefined) return undefined
  const concept = eventNameKeyByConcept[metricKey] ?? eventNameKeyByConcept[metricConcept(metricKey)]
  return concept === undefined ? undefined : text.eventNames[concept]
}

/** 概念归一：读契约那张唯一表，不在本地再写一份口径映射（未知码原样返回）。 */
function metricConcept(metricKey: string): string {
  return metricConceptOf(metricKey)
}
