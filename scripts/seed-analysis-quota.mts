#!/usr/bin/env tsx
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { analysisBudgetPolicy } from '@products/market-intelligence/service/intelligence/analysis/analysisBudgetPolicy'
import { countAnalysisRuns } from '@products/market-intelligence/service/intelligence/analysis/analysisRunCounter'
import { createMarketAnalysisRepository } from '@products/market-intelligence/service/intelligence/store/marketAnalysisRepository'
import { markTempDirectoryVerified } from '@platform/storage/sqlite/tempDirectoryReadiness'

/**
 * Fills today's analysis-run counters so P3 (「今天的分析次数用完了」) can be triggered by hand.
 *
 * Why a fixture instead of running 48 analyses: the quota is counted from trigger-ledger rows
 * (`countAnalysisRuns`), and that count is the only thing standing between the reader and a
 * refusal. Running 48 real analyses to reach it costs a day and a lot of tokens; shifting the
 * clock would drag every other date-derived value with it. This writes the ledger state the day
 * would have produced — decided rows for today's UTC day — into a throwaway profile the app can
 * be pointed at with `MACROBAY_USER_DATA`.
 *
 * It never touches a real profile: the target directory is the one passed with `--out`, and the
 * script refuses to run when that directory already holds an analysis database.
 *
 *   pnpm seed:analysis-quota --out /tmp/analysis-quota
 *   MACROBAY_USER_DATA=/tmp/analysis-quota pnpm dev
 *
 * Then trigger one automatic data-driven analysis (市场日历的「Refresh now」, or wait for a module
 * signal). The gate refuses it with `day-budget-exhausted` and submits P3 once. A second trigger
 * the same UTC day merges into the same notification row — by design, the key is the day.
 */

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  const value = process.argv[i + 1]
  if (!key?.startsWith('--') || value === undefined) throw new Error(`usage: --out <dir> [--day YYYY-MM-DD] [--event N] [--calendar N] (got ${key ?? 'nothing'})`)
  args.set(key.slice(2), value)
}
const out = args.get('out')
if (!out) throw new Error('usage: --out <dir> [--day YYYY-MM-DD] [--event N] [--calendar N]')
const day = args.get('day') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`--day must be YYYY-MM-DD (got ${day})`)
const eventRuns = Number(args.get('event') ?? analysisBudgetPolicy.lineQuotas.event.daily)
const calendarRuns = Number(args.get('calendar') ?? analysisBudgetPolicy.lineQuotas.calendar.daily)
for (const [name, count] of [['--event', eventRuns], ['--calendar', calendarRuns]] as const) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${name} must be a non-negative integer`)
}

const productDir = join(resolve(out), 'products', 'market-intelligence')
mkdirSync(productDir, { recursive: true })
const dbPath = join(productDir, 'market-analysis.sqlite')
// 目标是脚本自己 `mkdirSync` 出来的目录：临时目录闸门是给「应用启动先探一次」用的，
// 脚本里显式打开（与 `seed-daily-briefing-history` 同一写法）。
markTempDirectoryVerified()
const repository = createMarketAnalysisRepository({ filePath: dbPath })

try {
  const now = `${day}T00:00:00.000Z`
  if (repository.listEventGroups().length > 0) throw new Error(`${dbPath} already holds analysis data; refusing to seed over it`)
  const groupId = 'mi-eg-seed-quota'
  repository.appendEventGroup({
    id: groupId,
    schemaVersion: 1,
    status: 'monitoring',
    groupType: 'macro',
    mergeKey: `seed-quota|${day}`,
    firstObservedAt: now,
    lastObservedAt: now,
    reviewDeadlineAt: now,
    eventRefs: [],
    triggerCount: eventRuns + calendarRuns,
    reviewCount: 0,
    currentSummaryId: null,
    supersededByGroupId: null,
    revision: 1,
    createdAt: now,
    updatedAt: now
  })

  const seed = (triggerKey: string, prefix: string, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      // Every row is inside the seeded UTC day; hours are spread so the ledger reads like a day.
      const minute = String(index % 60).padStart(2, '0')
      const hour = String(Math.floor(index / 60)).padStart(2, '0')
      repository.appendTriggerLedger({
        id: `mi-tl-${prefix}-${String(index).padStart(3, '0')}`,
        eventGroupId: groupId,
        triggerKey,
        changeHash: `${prefix}-${index}`,
        decision: 'queued',
        reasonCode: 'seed-quota',
        snapshotHash: null,
        analysisRunId: null,
        createdAt: `${day}T${hour}:${minute}:00.000Z`
      })
    }
  }
  // The item line counts against its own 48; the calendar line has its own nine. Both are seeded by
  // default so whichever line a real trigger lands on is already spent.
  seed('macro.actual.first-confirmed', 'event', eventRuns)
  seed('calendar.refresh', 'calendar', calendarRuns)

  const counts = countAnalysisRuns(repository, `${day}T12:00:00.000Z`)
  if (counts.eventRunsToday < eventRuns || counts.calendarRunsToday < calendarRuns) {
    throw new Error(`seeded rows do not add up: ${JSON.stringify(counts)}`)
  }
  console.log(`seeded ${day}: event ${counts.eventRunsToday}/${analysisBudgetPolicy.lineQuotas.event.daily}, calendar ${counts.calendarRunsToday}/${analysisBudgetPolicy.lineQuotas.calendar.daily}`)
  console.log(`profile: ${resolve(out)}`)
  console.log(`next:    MACROBAY_USER_DATA=${resolve(out)} pnpm dev, then trigger one automatic analysis (market calendar → Refresh now, or a module signal)`)
} finally {
  repository.close()
}
