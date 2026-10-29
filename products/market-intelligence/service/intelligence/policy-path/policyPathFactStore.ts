import type { createMacroCalendarSqlite } from '../macro-calendar/macroCalendarSqlite'

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
  detectedAt: string
}>

export type PolicyPathFactStore = Readonly<{
  recordSchedule: (facts: PolicyPathScheduleFact) => void
  recordDecision: (facts: PolicyPathDecisionFact) => void
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
       vote_for = coalesce(excluded.vote_for, mi_policy_path_facts.vote_for),
       vote_against = coalesce(excluded.vote_against, mi_policy_path_facts.vote_against),
       dissents_json = coalesce(excluded.dissents_json, mi_policy_path_facts.dissents_json),
       statement_url = excluded.statement_url,
       detected_at = excluded.detected_at`
  )
  const select = database.prepare('select * from mi_policy_path_facts where meeting_date = ? limit 1')
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
    read(meetingDate) {
      const row = select.get(meetingDate) as FactRow | undefined
      return row ? toFacts(row) : undefined
    }
  })
}

function toFacts(row: FactRow): PolicyPathFacts {
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
    detectedAt: String(row.detected_at)
  }
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
