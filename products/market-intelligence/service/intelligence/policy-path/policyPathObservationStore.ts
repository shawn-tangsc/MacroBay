import type { createMacroCalendarSqlite } from '../macro-calendar/macroCalendarSqlite'
import type { PolicyPathObservation, PolicyPathOutcome, PolicyPathQuote } from '../../../contracts/policyPath'
import { POLICY_PATH_OUTCOMES } from '../../../contracts/policyPath'

/**
 * The market's implied odds are stored as a series, not as a latest value.
 *
 * Every refresh used to overwrite the previous read, which made "did it move today" unanswerable.
 * A row per observation costs little (about seventy a day at the 10/30-minute cadence) and is the
 * only way the trailing range can be computed from what this machine actually saw.
 */
export type PolicyPathObservationStore = Readonly<{
  append: (meetingDate: string, observation: PolicyPathObservation) => void
  /** Oldest to newest, capped at `limit` rows taken from the tail. */
  list: (meetingDate: string, limit: number) => readonly PolicyPathObservation[]
}>

type Database = ReturnType<typeof createMacroCalendarSqlite>['database']
type Row = Record<string, unknown>

export function createPolicyPathObservationStore(database: Database): PolicyPathObservationStore {
  const insert = database.prepare(
    `insert into mi_policy_path_observations (meeting_date, at, values_json, quote_json)
     values (?, ?, ?, ?)
     on conflict(meeting_date, at) do nothing`
  )
  const select = database.prepare(
    'select * from mi_policy_path_observations where meeting_date = ? order by at desc limit ?'
  )
  return Object.freeze({
    append(meetingDate, observation) {
      insert.run(
        meetingDate,
        observation.at,
        JSON.stringify(observation.values),
        observation.quote ? JSON.stringify(observation.quote) : null
      )
    },
    list(meetingDate, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) return []
      const rows = select.all(meetingDate, limit) as Row[]
      return rows.map(toObservation).filter((row): row is PolicyPathObservation => row !== undefined).reverse()
    }
  })
}

function toObservation(row: Row): PolicyPathObservation | undefined {
  const at = typeof row.at === 'string' ? row.at : undefined
  const values = parseValues(row.values_json)
  if (!at || !values) return undefined
  const quote = parseQuote(row.quote_json)
  return { at, values, ...(quote ? { quote } : {}) }
}

function parseValues(value: unknown): PolicyPathObservation['values'] | undefined {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  const values = Object.fromEntries(
    POLICY_PATH_OUTCOMES.map((outcome) => [outcome, record[outcome]])
  ) as Record<PolicyPathOutcome, unknown>
  const usable = POLICY_PATH_OUTCOMES.every((outcome) => {
    const candidate = values[outcome]
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 1
  })
  return usable ? values as Record<PolicyPathOutcome, number> : undefined
}

function parseQuote(value: unknown): PolicyPathQuote | undefined {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object') return undefined
  const { bid, ask } = parsed as Record<string, unknown>
  return typeof bid === 'number' && typeof ask === 'number' && bid >= 0 && ask <= 1 && bid <= ask ? { bid, ask } : undefined
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
