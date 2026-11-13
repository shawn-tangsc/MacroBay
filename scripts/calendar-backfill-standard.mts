#!/usr/bin/env tsx
/** 从观测表回填标准表：默认 dry-run 只报数，`--apply` 才写库。 */
import { DatabaseSync } from 'node:sqlite'

import { markTempDirectoryVerified } from '../platform/storage/sqlite/tempDirectoryReadiness'
import { narwhalCanonicalIdentityKey } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarMetricIdentity'
import { routeStandardRelease } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarStandardRowRouting'

const [dbPath, ...flags] = process.argv.slice(2)
if (dbPath === undefined) { console.error('用法：calendar-backfill-standard.mts <库路径> [--apply]'); process.exit(1) }
const apply = flags.includes('--apply')
markTempDirectoryVerified()
const db = new DatabaseSync(dbPath, apply ? {} : { readOnly: true })
const rows = db.prepare(`select source_event_id, market_fact_key, display_name, country_code,
  scheduled_date, scheduled_at, measure_keys_json
  from mi_macro_calendar_market_event_observations where provider_id = 'narwhal'
  order by source_event_id, coalesce(last_seen_at,'') asc`).all() as Record<string, unknown>[]
const latest = new Map<string, Record<string, unknown>>()
for (const row of rows) latest.set(String(row.source_event_id), row)
let indicator = 0, event = 0, source = 0, unmapped = 0
for (const row of latest.values()) {
  const identity = row.market_fact_key === null ? undefined : narwhalCanonicalIdentityKey(String(row.market_fact_key))
  const parts = identity?.split('|') ?? []
  const measures = String(row.measure_keys_json ?? '[]')
  const hasValues = measures !== '[]' && measures !== 'null' && measures !== ''
  if (identity === undefined || parts.length !== 3) { unmapped += 1; continue }
  const route = routeStandardRelease({ hasPeriod: (parts[2] ?? '').length > 0, hasValues,
    sourceName: String(row.display_name ?? '') })
  if (route.kind === 'indicator') indicator += 1
  else if (route.kind === 'event') event += 1
  else if (route.kind === 'source') source += 1
  else unmapped += 1
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', observations: rows.length,
  releases: latest.size, indicator, event, source, unmapped }, null, 0))
