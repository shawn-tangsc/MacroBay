import type { DatabaseSync } from 'node:sqlite'

import type { MacroCalendarInterpretationInput, MacroCalendarInterpretationView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { registeredEventNames } from '../../../contracts/indicatorNames'
import type { MacroCalendarRepository } from './macroCalendarRepository'
import type { MacroCalendarRevision } from './macroCalendarContracts'
import { buildCalendarInterpretationEnvelope } from './interpretation/calendarEventInterpretationEnvelope'
import type { createCalendarInterpretationGenerator } from './interpretation/calendarEventInterpretationGenerator'
import { calendarInterpretationDataKey, calendarInterpretationTier } from './interpretation/calendarEventInterpretationPolicy'
import { readCalendarInterpretation } from './interpretation/calendarEventInterpretationStore'

/**
 * 解读的读写口（R36 #34 第二半）：**档门控在服务侧，界面只是发起方**。
 *
 * 界面不需要知道「这一条是高档还是中档」——它只问「有没有」，没有就说「生成一次」。
 * 低档与未分级在服务侧直接 `not-applicable`，所以「低档也生成」在结构上做不到，
 * 不是靠渲染层记得不去调。
 */
export type MacroCalendarInterpretationService = Readonly<{
  read: (input: MacroCalendarInterpretationInput) => MacroCalendarInterpretationView
  request: (input: MacroCalendarInterpretationInput) => Promise<MacroCalendarInterpretationView>
  /** 后台补生成（高档）：失败不重试，口径与 `request` 的自动路径一致。 */
  backfill: (input: MacroCalendarInterpretationInput) => Promise<MacroCalendarInterpretationView>
}>

export type MacroCalendarInterpretationServiceDeps = Readonly<{
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf' | 'listEffectiveMonthAsOf'>
  database: DatabaseSync
  generator: ReturnType<typeof createCalendarInterpretationGenerator>
  now: () => string
  /** 往期读多少个月：够覆盖季度指标的三期即可（GDP 是季频）。 */
  historyMonths?: number
}>

const historyMonthsDefault = 6
/** 与服务侧同一份上限：`listEffectiveMonthAsOf` 只取一个月的事件，这里不需要翻页。 */
const monthLimit = 40

export function createMacroCalendarInterpretationService(deps: MacroCalendarInterpretationServiceDeps): MacroCalendarInterpretationService {
  function resolve(input: MacroCalendarInterpretationInput): Readonly<{
    revision: MacroCalendarRevision
    dataKey: string
  }> | undefined {
    const revision = deps.repository.getEffectiveEventAsOf({ eventKey: input.eventKey, asOf: deps.now() })
    if (revision === undefined) return undefined
    const dataKey = calendarInterpretationDataKey(displayValues(revision))
    return { revision, dataKey }
  }

  function read(input: MacroCalendarInterpretationInput): MacroCalendarInterpretationView {
    const resolved = resolve(input)
    if (resolved === undefined) return { state: 'absent' }
    if (calendarInterpretationTier(resolved.revision.importanceGrade) === 'never') return { state: 'not-applicable' }
    const row = readCalendarInterpretation(deps.database, {
      eventKey: input.eventKey, dataKey: resolved.dataKey, locale: input.locale
    })
    if (row === undefined) return { state: 'absent' }
    if (row.state === 'ready' && row.text !== undefined) {
      return { state: 'ready', text: row.text, generatedAt: row.generatedAt, evidenceScope: row.evidenceScope }
    }
    return { state: 'failed', failureCode: row.failureCode ?? 'provider-error' }
  }

  async function generate(input: MacroCalendarInterpretationInput, trigger: 'auto' | 'request'): Promise<MacroCalendarInterpretationView> {
    const resolved = resolve(input)
    if (resolved === undefined) return { state: 'absent' }
    const revision = resolved.revision
    const result = await deps.generator.generate({
      eventKey: input.eventKey,
      importance: revision.importanceGrade,
      locale: input.locale,
      values: displayValues(revision),
      trigger,
      buildEnvelope: () => buildCalendarInterpretationEnvelope({
        event: {
          eventKey: input.eventKey,
          title: readableName(revision, input.locale),
          country: revision.countryCode,
          importance: revision.importanceGrade ?? 'medium',
          periodKey: revision.periodKey,
          scheduledDate: revision.scheduledDate,
          ...(revision.scheduledAt === undefined ? {} : { scheduledAt: revision.scheduledAt }),
          ...(revision.actual === undefined ? {} : { actual: revision.actual.displayValue }),
          ...(revision.previous === undefined ? {} : { previous: revision.previous.displayValue }),
          ...(revision.consensus === undefined ? {} : { consensus: revision.consensus.displayValue }),
          source: sourceNameOf(revision.providerId)
        },
        history: historyOf(revision)
      })
    })
    if (result.state === 'ready') {
      return { state: 'ready', text: result.text, generatedAt: result.generatedAt, evidenceScope: result.evidenceScope }
    }
    if (result.state === 'failed') return { state: 'failed', failureCode: result.failureCode }
    return { state: 'not-applicable' }
  }

  /** 往期：同一指标键、已发布、在本期之前，最近的几条（最多三条，按发布日倒序）。 */
  function historyOf(revision: MacroCalendarRevision): readonly Readonly<{ periodKey: string; actual?: string; previous?: string }>[] {
    const months = deps.historyMonths ?? historyMonthsDefault
    const anchor = new Date(`${revision.scheduledDate}T00:00:00.000Z`)
    const rows: MacroCalendarRevision[] = []
    for (let offset = 1; offset <= months; offset += 1) {
      const start = new Date(anchor)
      start.setUTCMonth(start.getUTCMonth() - offset, 1)
      const end = new Date(start)
      end.setUTCMonth(end.getUTCMonth() + 1, 1)
      rows.push(...deps.repository.listEffectiveMonthAsOf({
        monthStart: start.toISOString().slice(0, 10),
        monthEndExclusive: end.toISOString().slice(0, 10),
        asOf: deps.now(), limit: monthLimit
      }))
    }
    return rows
      .filter((row) => row.eventNameKey === revision.eventNameKey && row.eventFamily === revision.eventFamily &&
        row.lifecycleState === 'released' && row.actual !== undefined && row.scheduledDate < revision.scheduledDate)
      .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate))
      .slice(0, 3)
      .map((row) => ({
        periodKey: row.periodKey,
        ...(row.actual === undefined ? {} : { actual: row.actual.displayValue }),
        ...(row.previous === undefined ? {} : { previous: row.previous.displayValue })
      }))
  }

  return {
    read,
    request: (input) => generate(input, 'request'),
    backfill: (input) => generate(input, 'auto')
  }
}

function displayValues(revision: MacroCalendarRevision): Readonly<{ actual?: string; consensus?: string; previous?: string }> {
  return {
    ...(revision.actual === undefined ? {} : { actual: revision.actual.displayValue }),
    ...(revision.consensus === undefined ? {} : { consensus: revision.consensus.displayValue }),
    ...(revision.previous === undefined ? {} : { previous: revision.previous.displayValue })
  }
}

/** 标题：九个已注册发布用同一张名字表（不新写一份措辞），其余退回指标键本身。 */
function readableName(revision: MacroCalendarRevision, locale: 'zh-CN' | 'en-US'): string {
  const names = registeredEventNames[locale] as Record<string, string>
  return names[revision.eventNameKey] ?? revision.eventNameKey
}

/** 来源显示名：与日历其它面同一套（BLS / BEA / Fed），认不出就用 feed id。 */
function sourceNameOf(providerId: string): string {
  if (providerId === 'macro-calendar-bls') return 'BLS'
  if (providerId === 'macro-calendar-bea') return 'BEA'
  if (providerId === 'macro-calendar-fed') return 'Fed'
  return providerId
}