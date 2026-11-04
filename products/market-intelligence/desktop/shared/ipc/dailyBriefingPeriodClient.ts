import { isDailyBriefingLocale, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { briefingPeriodDraftIssue, type BriefingPeriod, type BriefingPeriodDraft } from '../../../contracts/dailyBriefingPeriod'
import { isRecord, isText } from './dailyBriefingDocument'

/**
 * The period configuration's own IPC client.
 *
 * Kept apart from `dailyBriefingClient` because it is a different capability with a different write
 * target: these four calls read and write the period store, never the old generation settings. The
 * dialog and the page import this surface, so a mistaken import cannot reach `saveSettings`.
 */
const PRODUCT_ID = 'market-intelligence'
const METHODS = Object.freeze({
  listPeriods: 'intelligence.dailyBriefing.listPeriods',
  createPeriod: 'intelligence.dailyBriefing.createPeriod',
  updatePeriod: 'intelligence.dailyBriefing.updatePeriod',
  removePeriod: 'intelligence.dailyBriefing.removePeriod'
})

/**
 * What a period write answers. The store's four outcomes are mirrored here so the dialog can name the
 * conflicting row or the field it must fix; anything else is refused as an unreadable result rather
 * than shown half-parsed.
 */
export type DailyBriefingPeriodWriteResult =
  | Readonly<{ state: 'saved'; period: BriefingPeriod; periods: readonly BriefingPeriod[] }>
  | Readonly<{ state: 'rejected'; code: 'daily-briefing-period-duplicate'; conflict: BriefingPeriod }>
  | Readonly<{ state: 'rejected'; code: 'daily-briefing-period-invalid'; issue: 'generation-time' | 'window-hours' | 'language' }>
  | Readonly<{ state: 'rejected'; code: 'daily-briefing-period-missing'; id: string }>

export type DailyBriefingPeriodRemoveResult =
  | Readonly<{ state: 'removed'; id: string; periods: readonly BriefingPeriod[] }>
  | Readonly<{ state: 'missing'; id: string }>

export type DailyBriefingPeriodClient = Readonly<{
  /** The saved period configuration; never the old generation settings. */
  list: (locale?: DailyBriefingLocale) => Promise<readonly BriefingPeriod[]>
  create: (draft: BriefingPeriodDraft, locale?: DailyBriefingLocale) => Promise<DailyBriefingPeriodWriteResult>
  update: (id: string, draft: BriefingPeriodDraft, locale?: DailyBriefingLocale) => Promise<DailyBriefingPeriodWriteResult>
  remove: (id: string, locale?: DailyBriefingLocale) => Promise<DailyBriefingPeriodRemoveResult>
}>

async function invoke(method: string, payload: unknown): Promise<unknown> {
  const products = window.platform?.products
  if (!products?.invoke) throw new Error('product-bridge-missing')
  return products.invoke(PRODUCT_ID, method, payload)
}

export const dailyBriefingPeriodClient: DailyBriefingPeriodClient = {
  async list(locale) {
    const value = await invoke(METHODS.listPeriods, locale ? { locale } : {})
    if (!Array.isArray(value)) throw new Error('daily-briefing-period-invalid-result')
    return Object.freeze(value.map((entry) => {
      const period = parseBriefingPeriod(entry)
      if (!period) throw new Error('daily-briefing-period-invalid-result')
      return period
    }))
  },
  async create(draft, locale) {
    return parsePeriodWriteResult(await invoke(METHODS.createPeriod, { draft, ...(locale ? { locale } : {}) }))
  },
  async update(id, draft, locale) {
    return parsePeriodWriteResult(await invoke(METHODS.updatePeriod, { id, draft, ...(locale ? { locale } : {}) }))
  },
  async remove(id, locale) {
    return parsePeriodRemoveResult(await invoke(METHODS.removePeriod, { id, ...(locale ? { locale } : {}) }))
  }
}

/** One stored period, refused unless every value is one this build can run. */
export function parseBriefingPeriod(value: unknown): BriefingPeriod | undefined {
  if (!isRecord(value) || !isText(value.id) || !isDailyBriefingLocale(value.language)) return undefined
  if (briefingPeriodDraftIssue({ generationTime: value.generationTime, windowHours: value.windowHours, language: value.language })) return undefined
  return Object.freeze({
    id: value.id,
    generationTime: value.generationTime as string,
    windowHours: value.windowHours as BriefingPeriod['windowHours'],
    language: value.language,
    ...(value.origin === 'legacy-settings' ? { origin: 'legacy-settings' as const } : {})
  })
}

function parseBriefingPeriods(value: unknown): readonly BriefingPeriod[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed: BriefingPeriod[] = []
  for (const entry of value) {
    const period = parseBriefingPeriod(entry)
    if (!period) return undefined
    parsed.push(period)
  }
  return Object.freeze(parsed)
}

function parsePeriodWriteResult(value: unknown): DailyBriefingPeriodWriteResult {
  if (!isRecord(value)) throw new Error('daily-briefing-period-invalid-result')
  if (value.state === 'saved') {
    const period = parseBriefingPeriod(value.period)
    const periods = parseBriefingPeriods(value.periods)
    if (!period || !periods) throw new Error('daily-briefing-period-invalid-result')
    return Object.freeze({ state: 'saved', period, periods })
  }
  if (value.code === 'daily-briefing-period-duplicate') {
    const conflict = parseBriefingPeriod(value.conflict)
    if (!conflict) throw new Error('daily-briefing-period-invalid-result')
    return Object.freeze({ state: 'rejected', code: 'daily-briefing-period-duplicate', conflict })
  }
  if (value.code === 'daily-briefing-period-invalid') {
    const issue = value.issue
    if (issue !== 'generation-time' && issue !== 'window-hours' && issue !== 'language') throw new Error('daily-briefing-period-invalid-result')
    return Object.freeze({ state: 'rejected', code: 'daily-briefing-period-invalid', issue })
  }
  if (value.code === 'daily-briefing-period-missing' && isText(value.id)) {
    return Object.freeze({ state: 'rejected', code: 'daily-briefing-period-missing', id: value.id })
  }
  throw new Error('daily-briefing-period-invalid-result')
}

function parsePeriodRemoveResult(value: unknown): DailyBriefingPeriodRemoveResult {
  if (!isRecord(value) || !isText(value.id)) throw new Error('daily-briefing-period-invalid-result')
  if (value.state === 'missing') return Object.freeze({ state: 'missing', id: value.id })
  const periods = parseBriefingPeriods(value.periods)
  if (value.state !== 'removed' || !periods) throw new Error('daily-briefing-period-invalid-result')
  return Object.freeze({ state: 'removed', id: value.id, periods })
}
