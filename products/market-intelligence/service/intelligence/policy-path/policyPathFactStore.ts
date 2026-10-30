import type { createMacroCalendarSqlite } from '../macro-calendar/macroCalendarSqlite'
import type { PolicyPathSep } from '../../../contracts/policyPath'

/**
 * Policy facts are the official readings behind the policy-path block: when the next meeting is,
 * whether it publishes projections, what the committee decided, who dissented and which way.
 *
 * They live beside the calendar but outside its revision chain: a revision's `actual` is a number
 * produced from the statement body, and a vote tally is not a number. Keeping them in their own
 * table also lets the two write points (schedule persistence for the projection marker, decision
 * refresh for the vote and range) write the same row without one overwriting the other.
 */
export type PolicyPathScheduleFact = Readonly<{
  meetingDate: string
  hasProjectionMaterials: boolean
  detectedAt: string
}>

export type PolicyPathDecisionFact = Readonly<{
  meetingDate: string
  targetRange: Readonly<{ lowerPercent: number; upperPercent: number }>
  vote?: Readonly<{ for: number; against: number }>
  dissents?: ReadonlyArray<Readonly<{ name: string; preferred: 'raise' | 'lower' | 'maintain' }>>
  statementUrl: string
  detectedAt: string
}>

export type PolicyPathFacts = Readonly<{
  meetingDate: string
  hasProjectionMaterials: boolean
  targetRange?: Readonly<{ lowerPercent: number; upperPercent: number }>
  vote?: Readonly<{ for: number; against: number }>
  dissents?: ReadonlyArray<Readonly<{ name: string; preferred: 'raise' | 'lower' | 'maintain' }>>
  statementUrl?: string
  sep?: PolicyPathSep
  detectedAt: string
}>

export type PolicyPathFactStore = Readonly<{
  recordSchedule: (facts: PolicyPathScheduleFact) => void
  recordDecision: (facts: PolicyPathDecisionFact) => void
  recordSep: (input: { meetingDate: string; sep: PolicyPathSep }) => void
  /** The most recent meeting at or before `asOf` that already has a decision. */
  readLatestDecision: (asOf: string) => PolicyPathFacts | undefined
  /** The most recent meeting at or before `asOf` that published projections and whose SEP is stored. */
  readLatestSep: (asOf: string) => PolicyPathFacts | undefined
  /** Projection meetings at or before `asOf`, newest first: which SEP tables are published by now. */
  listProjectionMeetings: (asOf: string, limit: number) => readonly string[]
  /** The most recent scheduled meeting at or before `asOf`, decided or not. */
  readLatestMeeting: (asOf: string) => string | undefined
  read: (meetingDate: string) => PolicyPathFacts | undefined
}>

type Database = ReturnType<typeof createMacroCalendarSqlite>['database']
type FactRow = Record<string, string | number | null>

export function createPolicyPathFactStore(database: Database): PolicyPathFactStore {
  const upsertSchedule = database.prepare(
    `insert into mi_policy_path_facts (meeting_date, has_projection_materials, detected_at)
     values (?, ?, ?)
     on conflict(meeting_date) do update set
       has_projection_materials = excluded.has_projection_materials,
       detected_at = excluded.detected_at`
  )
  const upsertDecision = database.prepare(
    `insert into mi_policy_path_facts (meeting_date, target_lower, target_upper, vote_for, vote_against, dissents_json, statement_url, detected_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(meeting_date) do update set
       target_lower = excluded.target_lower,
       target_upper = excluded.target_upper,
       -- The decision write is authoritative for the decision columns: a unanimous statement
       -- clears the previous meeting's dissents instead of leaving them to look current.
       vote_for = excluded.vote_for,
       vote_against = excluded.vote_against,
       dissents_json = excluded.dissents_json,
       statement_url = excluded.statement_url,
       detected_at = excluded.detected_at`
  )
  const upsertSep = database.prepare(
    `insert into mi_policy_path_sep (meeting_date, sep_json, detected_at)
     values (?, ?, ?)
     on conflict(meeting_date) do update set sep_json = excluded.sep_json, detected_at = excluded.detected_at`
  )
  const selectSep = database.prepare('select sep_json from mi_policy_path_sep where meeting_date = ? limit 1')
  const select = database.prepare('select * from mi_policy_path_facts where meeting_date = ? limit 1')
  const selectLatestSep = database.prepare(
    'select * from mi_policy_path_facts where meeting_date <= ? and has_projection_materials = 1 order by meeting_date desc limit 1'
  )
  const selectLatestMeeting = database.prepare(
    'select meeting_date from mi_policy_path_facts where meeting_date <= ? order by meeting_date desc limit 1'
  )
  const selectProjectionMeetings = database.prepare(
    'select meeting_date from mi_policy_path_facts where meeting_date <= ? and has_projection_materials = 1 order by meeting_date desc limit ?'
  )
  const selectLatestDecision = database.prepare(
    'select * from mi_policy_path_facts where meeting_date <= ? and target_lower is not null order by meeting_date desc limit 1'
  )
  return Object.freeze({
    recordSchedule(facts) {
      upsertSchedule.run(facts.meetingDate, facts.hasProjectionMaterials ? 1 : 0, facts.detectedAt)
    },
    recordDecision(facts) {
      upsertDecision.run(
        facts.meetingDate,
        facts.targetRange.lowerPercent,
        facts.targetRange.upperPercent,
        facts.vote?.for ?? null,
        facts.vote?.against ?? null,
        facts.dissents ? JSON.stringify(facts.dissents) : null,
        facts.statementUrl,
        facts.detectedAt
      )
    },
    recordSep({ meetingDate, sep }) {
      upsertSep.run(meetingDate, JSON.stringify(sep), sep.asOf)
    },
    readLatestMeeting(asOf) {
      const row = selectLatestMeeting.get(asOf.slice(0, 10)) as { meeting_date: string } | undefined
      return row?.meeting_date
    },
    readLatestSep(asOf) {
      const row = selectLatestSep.get(asOf.slice(0, 10)) as FactRow | undefined
      if (!row) return undefined
      return toFacts(row, parseSep((selectSep.get(String(row.meeting_date)) as { sep_json?: unknown } | undefined)?.sep_json))
    },
    listProjectionMeetings(asOf, limit) {
      return (selectProjectionMeetings.all(asOf.slice(0, 10), Math.max(1, limit)) as Array<{ meeting_date: string }>)
        .map((row) => row.meeting_date)
    },
    readLatestDecision(asOf) {
      const row = selectLatestDecision.get(asOf.slice(0, 10)) as FactRow | undefined
      if (!row) return undefined
      return toFacts(row, parseSep((selectSep.get(String(row.meeting_date)) as { sep_json?: unknown } | undefined)?.sep_json))
    },
    read(meetingDate) {
      const row = select.get(meetingDate) as FactRow | undefined
      const sepRow = selectSep.get(meetingDate) as { sep_json?: unknown } | undefined
      const sep = parseSep(sepRow?.sep_json)
      if (!row) return undefined
      return toFacts(row, sep)
    }
  })
}

function toFacts(row: FactRow, sep: PolicyPathSep | undefined): PolicyPathFacts {
  const lower = row.target_lower === null || row.target_lower === undefined ? undefined : Number(row.target_lower)
  const upper = row.target_upper === null || row.target_upper === undefined ? undefined : Number(row.target_upper)
  const voteFor = row.vote_for === null || row.vote_for === undefined ? undefined : Number(row.vote_for)
  const voteAgainst = row.vote_against === null || row.vote_against === undefined ? undefined : Number(row.vote_against)
  const dissents = typeof row.dissents_json === 'string' ? parseDissents(row.dissents_json) : undefined

  return {
    meetingDate: String(row.meeting_date),
    hasProjectionMaterials: Number(row.has_projection_materials) === 1,
    ...(lower !== undefined && upper !== undefined ? { targetRange: { lowerPercent: lower, upperPercent: upper } } : {}),
    ...(voteFor !== undefined && voteAgainst !== undefined ? { vote: { for: voteFor, against: voteAgainst } } : {}),
    ...(dissents ? { dissents } : {}),
    ...(typeof row.statement_url === 'string' ? { statementUrl: row.statement_url } : {}),
    ...(sep ? { sep } : {}),
    detectedAt: String(row.detected_at)
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseSep(value: unknown): PolicyPathSep | undefined {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object') return undefined
  const row = parsed as Partial<PolicyPathSep>
  if (typeof row.asOf !== 'string' || typeof row.sourceUrl !== 'string' || !row.medianPath) return undefined
  return row as PolicyPathSep
}

function parseDissents(value: string): PolicyPathFacts['dissents'] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    const rows = parsed.filter((row): row is { name: string; preferred: 'raise' | 'lower' | 'maintain' } =>
      typeof row === 'object' && row !== null &&
      typeof (row as { name?: unknown }).name === 'string' &&
      ['raise', 'lower', 'maintain'].includes((row as { preferred?: string }).preferred ?? ''))
    return rows.length ? rows.map((row) => ({ name: row.name, preferred: row.preferred })) : undefined
  } catch {
    return undefined
  }
}
