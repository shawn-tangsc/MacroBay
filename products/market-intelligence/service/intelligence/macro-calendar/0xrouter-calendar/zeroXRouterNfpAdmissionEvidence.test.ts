import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

// Opt-in read-only product evidence audit. Never exercised by normal test/renderer
// paths. Failure output is boolean-only, not raw provider body or row snapshots.
const root = process.env.MI_CALENDAR_EVIDENCE_AUDIT_ROOT
it.skipIf(!root)('verifies the pending single-batch NFP admission against local evidence and official facts', () => {
  const hash = '7f61e71c134bb5fd038a6dd63975b128162244e12b58750ebfe922ab57b0fd8c'
  const body = readFileSync(join(root!, 'macro-calendar-evidence', `${hash}.bin`))
  expect(createHash('sha256').update(body).digest('hex') === hash).toBe(true)
  const envelope = JSON.parse(body.toString('utf8'))
  expect(envelope.code === 200 && Array.isArray(envelope.data)).toBe(true)
  const rows = envelope.data.filter((row: Record<string, unknown>) => String(row.indicatorsId) === '8656')
  expect(rows.length === 1).toBe(true)
  const row = rows[0]
  expect(row.calendarId === '212987' && row.id === 73616 && row.locale === 'zh').toBe(true)
  expect(row.countryCode === 'USA' && row.dataTime === '2026-08').toBe(true)
  expect(row.calendarName === '8月季调后非农就业人口变动(千人)').toBe(true)
  expect(row.pubTimestamp === Date.parse('2026-09-04T12:30:00.000Z')).toBe(true)
  expect(row.estimateValue !== null && row.estimateValue !== undefined && String(row.estimateValue).trim() !== '').toBe(true)
  const database = new DatabaseSync(join(root!, 'macro-calendar.sqlite'), { readOnly: true })
  try {
    const collections = database.prepare(`select * from mi_macro_calendar_market_event_collections
      where evidence_hash = ? and descriptor_id = ? and locale = ?`).all(hash, 'macro-calendar-0xrouter-economic-data', 'zh')
    expect(collections.length === 1).toBe(true)
    const observations = database.prepare(`select * from mi_macro_calendar_market_event_observations
      where collection_id = ? and indicator_id = ?`).all(collections[0]!.collection_id, '8656')
    expect(observations.length === 1).toBe(true)
    expect(observations[0]!.source_event_id === JSON.stringify(['212987', 73616]) && observations[0]!.identity_state === 'unverified').toBe(true)
    const official = database.prepare(`select * from mi_macro_calendar_revisions where event_key = ?
      order by detected_at desc limit 1`).get('US.NONFARM_PAYROLLS.RELEASE.2026-M08')!
    expect(Boolean(official) && official.release_group_key === 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M08' &&
      official.period_key === '2026-M08' && official.scheduled_date === '2026-09-04' && official.scheduled_at === null).toBe(true)
    expect(JSON.parse(String(official.actual_json)).unit === 'thousands' && JSON.parse(String(official.previous_json)).unit === 'thousands').toBe(true)
  } finally { database.close() }
})
