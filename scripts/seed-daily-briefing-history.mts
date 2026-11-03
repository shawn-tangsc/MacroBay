#!/usr/bin/env tsx
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Seeds a throwaway data directory with a history that shows one cleaned writing attempt.
 *
 * Why a fixture instead of waiting: the attempt row outlives its session by a week (sessions are
 * cleaned on day seven, editions on day fourteen), so "that attempt was cleaned up" is only visible
 * during that week. Waiting seven days to take a screenshot is not an acceptance path; shifting the
 * system clock would drag every other date-derived value with it. This writes the state the cleanup
 * pass produces — attempt row kept, trace emptied, `cleaned_at` set — into a temporary profile the
 * app can be pointed at with `MACROBAY_USER_DATA`.
 *
 * The row shapes below match storage version 3. The script refuses to write into a directory that
 * already holds a briefing database, so it can never touch a reader's real data.
 *
 *   pnpm exec tsx scripts/seed-daily-briefing-history.mts --out /tmp/briefing-history
 *   MACROBAY_USER_DATA=/tmp/briefing-history pnpm dev
 */

const STORAGE_VERSION = 3
const PRODUCT_DIR = 'market-intelligence'
const PERIOD_ID = 'default'
/** The four reading rows every edition of this fixture carries. */
const editionRowIds = ['fear-greed', 'funding', 'capital', 'calendar']

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  const value = process.argv[i + 1]
  if (!key?.startsWith('--') || value === undefined) throw new Error(`usage: --out <dir> [--today YYYY-MM-DD] (got ${key ?? 'nothing'})`)
  args.set(key.slice(2), value)
}
const out = args.get('out')
if (!out) throw new Error('usage: --out <dir> [--today YYYY-MM-DD]')
const today = args.get('today') ?? localDate(new Date())
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`--today must be YYYY-MM-DD (got ${today})`)

/** Sessions are cleaned on day 7; the edition lives to day 14. Ten days in is inside both windows. */
const cleanedEdition = shift(today, -10)
/** One day back: a normal row beside the cleaned one, so the difference is visible in one screen. */
const liveEdition = shift(today, -1)

const productDir = join(resolve(out), 'products', PRODUCT_DIR)
mkdirSync(productDir, { recursive: true })

const briefingsPath = join(productDir, 'daily-briefings.sqlite')
const sessionsPath = join(productDir, 'daily-brief-sessions.sqlite')

const briefings = new DatabaseSync(briefingsPath)
briefings.exec('pragma user_version = 0')
const existing = briefings.prepare("select name from sqlite_master where type = 'table' and name = 'daily_briefings'").get()
if (existing) throw new Error(`${briefingsPath} already holds a briefing database; refusing to overwrite it`)
briefings.exec(`
  create table daily_briefings (
    edition_date text not null,
    period_id text not null default '${PERIOD_ID}',
    locale text not null,
    generated_at text not null,
    window_start text not null,
    window_end text not null,
    document_json text not null,
    schema_version integer not null,
    primary key (edition_date, period_id, locale)
  );
  create table daily_briefing_attempts (
    edition_date text not null,
    period_id text not null default '${PERIOD_ID}',
    locale text not null,
    attempt_no integer not null,
    state text not null check(state in ('running','succeeded','failed')),
    failure_code text,
    started_at text not null,
    finished_at text,
    trace_json text,
    cleaned_at text,
    primary key (edition_date, period_id, locale, attempt_no)
  );
  create index idx_daily_briefing_attempts_period on daily_briefing_attempts(edition_date, period_id);
  create table daily_briefing_period_runs (
    edition_date text not null,
    period_id text not null,
    expected_locales text not null,
    primary_requested text not null,
    primary_used text not null,
    fallback_reason text,
    snapshot_id text not null,
    snapshot_hash text not null,
    content_version integer not null default 1,
    writing_rounds integer not null default 0,
    direction text not null default 'undecided',
    edition_rows text not null default '[]',
    state text not null check(state in ('running','published','partial','failed')),
    started_at text not null,
    finished_at text,
    primary key (edition_date, period_id)
  );
  pragma user_version = ${STORAGE_VERSION};
`)

const insertEdition = briefings.prepare(`insert into daily_briefings
  (edition_date, period_id, locale, generated_at, window_start, window_end, document_json, schema_version)
  values (?, ?, ?, ?, ?, ?, ?, ?)`)
const insertAttempt = briefings.prepare(`insert into daily_briefing_attempts
  (edition_date, period_id, locale, attempt_no, state, failure_code, started_at, finished_at, trace_json, cleaned_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const insertRun = briefings.prepare(`insert into daily_briefing_period_runs
  (edition_date, period_id, expected_locales, primary_requested, primary_used, fallback_reason,
   snapshot_id, snapshot_hash, content_version, writing_rounds, direction, edition_rows, state, started_at, finished_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

const LOCALES = ['zh-CN', 'en-US'] as const

// Both languages are written for each day, because the acceptance row has to show the in-row
// language switch working on the same period, not two unrelated rows.
for (const date of [cleanedEdition, liveEdition]) {
  for (const locale of LOCALES) {
    insertEdition.run(date, PERIOD_ID, locale, `${date}T00:30:00.000Z`, `${date}T00:00:00.000Z`, `${date}T00:30:00.000Z`, JSON.stringify(document(date, locale)), STORAGE_VERSION)
  }
  insertRun.run(date, PERIOD_ID, JSON.stringify([...LOCALES]), 'zh-CN', 'zh-CN', null,
    `seed-${date}`, `seed-${date}`, 1, 2, 'undecided', JSON.stringify(editionRowIds), 'published',
    `${date}T00:00:00.000Z`, `${date}T00:30:00.000Z`)
}

// First attempt of the ten-day-old edition (Chinese): the writing round failed. Its trace is still
// there, so the rail can expand it and show what stopped.
insertAttempt.run(cleanedEdition, PERIOD_ID, 'zh-CN', 1, 'failed', 'agent-timeout',
  `${cleanedEdition}T00:05:00.000Z`, `${cleanedEdition}T00:12:00.000Z`, JSON.stringify(trace(cleanedEdition, 'failed')), null)
// Second Chinese attempt succeeded and its session was cleaned on day seven: row kept, trace
// emptied, `cleaned_at` set. This is the state the acceptance screenshot has to show.
insertAttempt.run(cleanedEdition, PERIOD_ID, 'zh-CN', 2, 'succeeded', null,
  `${cleanedEdition}T00:20:00.000Z`, `${cleanedEdition}T00:30:00.000Z`, null, `${shift(cleanedEdition, 7)}T08:10:00.000Z`)
// The English edition of the same day keeps its single attempt and its trace, so switching the row's
// language shows a different attempt list of the same period.
insertAttempt.run(cleanedEdition, PERIOD_ID, 'en-US', 1, 'succeeded', null,
  `${cleanedEdition}T00:20:00.000Z`, `${cleanedEdition}T00:30:00.000Z`, JSON.stringify(trace(cleanedEdition, 'success')), null)
// The live day keeps its attempt and its session, so the two cases sit side by side.
insertAttempt.run(liveEdition, PERIOD_ID, 'zh-CN', 1, 'succeeded', null,
  `${liveEdition}T00:20:00.000Z`, `${liveEdition}T00:30:00.000Z`, JSON.stringify(trace(liveEdition, 'success')), null)
insertAttempt.run(liveEdition, PERIOD_ID, 'en-US', 1, 'succeeded', null,
  `${liveEdition}T00:20:00.000Z`, `${liveEdition}T00:30:00.000Z`, JSON.stringify(trace(liveEdition, 'success')), null)
briefings.close()

const sessions = new DatabaseSync(sessionsPath)
sessions.exec(`
  create table if not exists daily_brief_session_links (
    session_id text primary key,
    edition_date text not null,
    period_id text not null,
    locale text not null,
    attempt_no integer,
    state text not null check(state in ('running','accepted','failed','abandoned')),
    created_at text not null,
    updated_at text not null
  );
  create index if not exists idx_daily_brief_session_links_edition on daily_brief_session_links(edition_date, period_id, locale, attempt_no);
  create index if not exists idx_daily_brief_session_links_date on daily_brief_session_links(edition_date);
  pragma user_version = 3;
`)
// Only the live attempt has a link: the cleaned one has no session left to open, which is what the
// tombstone on its attempt row says.
sessions.prepare(`insert into daily_brief_session_links
  (session_id, edition_date, period_id, locale, attempt_no, state, created_at, updated_at)
  values (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(`seed-live-${liveEdition}`, liveEdition, PERIOD_ID, 'zh-CN', 1, 'accepted', `${liveEdition}T00:20:00.000Z`, `${liveEdition}T00:30:00.000Z`)
// The English attempt of the cleaned day was not cleaned: its session is still there, which is why
// the row's language switch shows a live attempt beside a cleaned one.
sessions.prepare(`insert into daily_brief_session_links
  (session_id, edition_date, period_id, locale, attempt_no, state, created_at, updated_at)
  values (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(`seed-en-${cleanedEdition}`, cleanedEdition, PERIOD_ID, 'en-US', 1, 'accepted', `${cleanedEdition}T00:20:00.000Z`, `${cleanedEdition}T00:30:00.000Z`)
sessions.close()

console.log(`seeded ${productDir}`)
console.log(`  edition ${cleanedEdition}: attempts 1 (failed, trace kept) and 2 (succeeded, cleaned_at ${shift(cleanedEdition, 7)})`)
console.log(`  edition ${liveEdition}: attempt 1 (succeeded, session still linked)`)
console.log(`run: MACROBAY_USER_DATA=${resolve(out)} pnpm dev`)

function localDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function trace(date: string, state: 'success' | 'failed'): unknown {
  return {
    attemptId: `seed-${date}`,
    startedAt: `${date}T00:05:00.000Z`,
    finishedAt: `${date}T00:30:00.000Z`,
    state,
    stages: state === 'failed'
      ? [
          { id: 'source', state: 'success', startedAt: `${date}T00:05:00.000Z`, finishedAt: `${date}T00:06:00.000Z`, durationMs: 60_000 },
          { id: 'writing', state: 'failed', startedAt: `${date}T00:06:00.000Z`, finishedAt: `${date}T00:12:00.000Z`, durationMs: 360_000, failureCode: 'agent-timeout', failureDetail: 'the writing turn stopped before it answered' }
        ]
      : [
          { id: 'source', state: 'success', startedAt: `${date}T00:20:00.000Z`, finishedAt: `${date}T00:21:00.000Z`, durationMs: 60_000 },
          { id: 'writing', state: 'success', startedAt: `${date}T00:21:00.000Z`, finishedAt: `${date}T00:29:00.000Z`, durationMs: 480_000 },
          { id: 'store', state: 'success', startedAt: `${date}T00:29:00.000Z`, finishedAt: `${date}T00:30:00.000Z`, durationMs: 60_000 }
        ]
  }
}

function document(date: string, locale: 'zh-CN' | 'en-US'): unknown {
  return {
    schemaVersion: 1,
    policyVersion: 'daily-briefing.v1',
    edition: {
      date, locale, generatedAt: `${date}T00:30:00.000Z`,
      windowStart: `${date}T00:00:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, timeZone: 'Asia/Shanghai'
    },
    status: {
      readings: editionRowIds.map((id) => ({ id, state: 'available' })),
      readingsAvailable: editionRowIds.length, readingsTotal: editionRowIds.length
    },
    lede: { source: 'template', text: locale === 'zh-CN' ? '种子数据：用于验收「那一次已清理」。' : 'Seeded data for the cleaned-attempt acceptance shot.', generatedAt: `${date}T00:30:00.000Z` },
    news: { items: [], macro: [], notes: {} },
    data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
    conclusion: null,
    next: { items: [] },
    citations: [],
    provenance: { summaryId: null, readAt: `${date}T00:30:00.000Z` }
  }
}
