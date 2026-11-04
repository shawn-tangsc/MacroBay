import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import {
  isDailyBriefingLocale,
  type DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import {
  briefingPeriodDraftIssue,
  type BriefingPeriodDraft
} from '../../../contracts/dailyBriefingPeriod'
import type { BriefingPeriodStore } from '../daily-briefing/dailyBriefingPeriodStore'
import { DAILY_BRIEFING_IPC_METHODS } from './registerDailyBriefingIpc'

const PRODUCT_ID = 'market-intelligence'

/**
 * The period configuration's write seam: four methods, one store.
 *
 * Validation happens twice on purpose: the shape here (a string is a string, an id is bounded) and
 * the rule inside the store (the hour is in the table, the triple is unique). The UI runs the same
 * rule before it enables Save, so an ordinary reader never sees the refusal; it exists for callers
 * that do not go through the form.
 *
 * Nothing here touches the old generation settings: `saveSettings` keeps its own file, and a test
 * asserts it is not written when a period is added.
 */
export function registerDailyBriefingPeriodIpc(register: ProductIpcRegistrar, store: BriefingPeriodStore): void {
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.listPeriods, async (payload) =>
    store.list(readLanguage(payload)))

  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.createPeriod, async (payload) => {
    const { draft, locale } = readDraftRequest(payload)
    return store.create(draft, locale)
  })

  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.updatePeriod, async (payload) => {
    const { id, draft, locale } = readDraftRequest(payload, true)
    return store.update(id, draft, locale)
  })

  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.removePeriod, async (payload) => {
    if (!isRecord(payload) || typeof payload.id !== 'string' || payload.id.length === 0 || payload.id.length > 64) {
      throw new Error('daily-briefing-invalid-request')
    }
    return store.remove(payload.id, readLanguage(payload))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readLanguage(payload: unknown): DailyBriefingLocale | undefined {
  if (!isRecord(payload)) return undefined
  return isDailyBriefingLocale(payload.locale) ? payload.locale : undefined
}

function readDraftRequest(payload: unknown, withId = false): Readonly<{
  id: string
  draft: BriefingPeriodDraft
  locale: DailyBriefingLocale | undefined
}> {
  if (!isRecord(payload) || !isRecord(payload.draft)) throw new Error('daily-briefing-invalid-request')
  const allowed = withId ? ['id', 'draft', 'locale'] : ['draft', 'locale']
  if (Object.keys(payload).some((key) => !allowed.includes(key))) throw new Error('daily-briefing-invalid-request')
  const draft = payload.draft
  if (Object.keys(draft).some((key) => !['generationTime', 'windowHours', 'language'].includes(key))) {
    throw new Error('daily-briefing-invalid-request')
  }
  // Shape first, rule second: the draft issue names the field the store would refuse anyway.
  const issue = briefingPeriodDraftIssue({
    generationTime: draft.generationTime,
    windowHours: draft.windowHours,
    language: draft.language
  })
  if (issue) throw new Error(`daily-briefing-period-invalid:${issue}`)
  const id = withId ? payload.id : ''
  if (withId && (typeof id !== 'string' || id.length === 0 || id.length > 64)) throw new Error('daily-briefing-invalid-request')
  return {
    id: typeof id === 'string' ? id : '',
    draft: {
      generationTime: draft.generationTime as string,
      windowHours: draft.windowHours as number,
      language: draft.language as DailyBriefingLocale
    },
    locale: readLanguage(payload)
  }
}
