import type { createMacroCalendarSqlite } from '../macro-calendar/macroCalendarSqlite'
import type { PolicyPathObservation, PolicyPathOutcome, PolicyPathQuote } from '../../../contracts/policyPath'
import { POLICY_PATH_OUTCOMES } from '../../../contracts/policyPath'

/**
 * The market's implied odds are stored as a series, not as a latest value.
 *
 * Every refresh used to overwrite the previous read, which made "did it move today" unanswerable.
 * A row per observation costs little (about seventy a day at the 10/30-minute cadence) and is the
 * only way the trailing range can be computed from what this machine actually saw.
 *
 * The read side takes a **time window plus a protective row cap**, never a bare row count: a count
 * silently truncates older history the moment the collector gets denser, and a reader would then see
 * a chart that believes it is showing everything. When the cap is hit, `truncated` is said out loud.
 */
export type PolicyPathObservationWindow = Readonly<{
  /** Only observations at or after this instant (inclusive). Must be a canonical UTC ISO string. */
  from?: string
  /** Protective ceiling on rows returned. Not a window. */
  limit: number
}>

export type PolicyPathObservationList = Readonly<{
  /** Oldest to newest. */
  observations: readonly PolicyPathObservation[]
  /** The cap was reached while older rows still existed inside the window. */
  truncated: boolean
}>

export type PolicyPathObservationStore = Readonly<{
  append: (meetingDate: string, observation: PolicyPathObservation) => void
  list: (meetingDate: string, window: PolicyPathObservationWindow) => PolicyPathObservationList
}>

type Database = ReturnType<typeof createMacroCalendarSqlite>['database']
type Row = Record<string, unknown>

export function createPolicyPathObservationStore(database: Database): PolicyPathObservationStore {
  const insert = database.prepare(
    `insert into mi_policy_path_observations (meeting_date, at, values_json, quote_json)
     values (?, ?, ?, ?)
     on conflict(meeting_date, at) do nothing`
  )
  const selectFrom = database.prepare(
    'select * from mi_policy_path_observations where meeting_date = ? and at >= ? order by at desc limit ?'
  )
  const selectAll = database.prepare(
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
    list(meetingDate, window) {
      if (!Number.isSafeInteger(window.limit) || window.limit < 1) return { observations: [], truncated: false }
      // One extra row is read so "there is older history beyond the cap" is observable; the extra
      // row itself is never returned.
      const cap = window.limit + 1
      const rows = (window.from === undefined
        ? selectAll.all(meetingDate, cap)
        : selectFrom.all(meetingDate, window.from, cap)) as Row[]
      const truncated = rows.length > window.limit
      const bounded = truncated ? rows.slice(0, window.limit) : rows
      return {
        observations: bounded.map(toObservation).filter((row): row is PolicyPathObservation => row !== undefined).reverse(),
        truncated
      }
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
