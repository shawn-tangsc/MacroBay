/**
 * The venue page each meeting's odds came from.
 *
 * The number is a market price, and a price the reader cannot open is a price they have to trust;
 * the slug is discovered at collection time, so it is stored next to the meeting rather than rebuilt
 * from a title that may change.
 */
export type PolicyPathMarketLink = Readonly<{ meetingDate: string; slug: string; url: string; detectedAt: string }>

export type PolicyPathMarketLinkStore = Readonly<{
  record: (input: { meetingDate: string; slug: string; detectedAt: string }) => void
  read: (meetingDate: string) => PolicyPathMarketLink | undefined
}>

import type { createMacroCalendarSqlite } from '../macro-calendar/macroCalendarSqlite'

type Database = ReturnType<typeof createMacroCalendarSqlite>['database']

const venueBase = 'https://polymarket.com/event/'

export function createPolicyPathMarketLinkStore(database: Database): PolicyPathMarketLinkStore {
  const upsert = database.prepare(
    `insert into mi_policy_path_market (meeting_date, slug, detected_at) values (?, ?, ?)
     on conflict(meeting_date) do update set slug = excluded.slug, detected_at = excluded.detected_at`
  )
  const select = database.prepare('select meeting_date, slug, detected_at from mi_policy_path_market where meeting_date = ? limit 1')
  return Object.freeze({
    record({ meetingDate, slug, detectedAt }) {
      upsert.run(meetingDate, slug, detectedAt)
    },
    read(meetingDate) {
      const row = select.get(meetingDate) as { meeting_date?: unknown; slug?: unknown; detected_at?: unknown } | undefined
      if (!row || typeof row.slug !== 'string' || typeof row.detected_at !== 'string') return undefined
      return { meetingDate: meetingDate, slug: row.slug, url: `${venueBase}${row.slug}`, detectedAt: row.detected_at }
    }
  })
}
