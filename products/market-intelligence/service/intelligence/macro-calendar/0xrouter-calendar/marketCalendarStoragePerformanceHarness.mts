import { mkdtempSync, rmSync, statfsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareMarketCollection, type MarketCollectionContext, zeroXRouterCalendarStoragePolicy as storagePolicy } from './marketCalendarStorageValidation.ts'
import { DatabaseSync } from 'node:sqlite'
import { createMarketCalendarEventRepository } from './marketCalendarEventRepository.ts'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser.ts'

// Test-only executable/helpers; never import into runtime. Product acceptance owns gates.
const harnessPolicy = Object.freeze({
  scales: [100_000, 1_000_000], batchRows: 1000, projectedBytesPerRow: 4400,
  preflightSpareBytes: 3 * 1024 ** 3, maximumRssIncrement: 192 * 1024 ** 2,
  queryPairs: 30, localePeriod: 20, batchP95Ms: 500, queryP95Ms: 200, startupP95Ms: 100,
  boundaryRowsPerBatch: 50, nodeMajor: '22'
})
type BatchInput = Parameters<ReturnType<typeof createMarketCalendarEventRepository>['appendCollection']>[0]
// Derived contract workload, not provider evidence. Calibrate through real parser + validator.
export function representativeMixedBatch(input: BatchInput, context: MarketCollectionContext) {
  const batch = input as { parseResult: Extract<ReturnType<typeof parseZeroXRouterEconomicData>, { state: 'succeeded' }>; collectionId: string }
  if (batch.parseResult.state !== 'succeeded' || batch.parseResult.drafts.length !== harnessPolicy.batchRows) throw new Error('mixed-row-count')
  const drafts = batch.parseResult.drafts.map((draft, index) => {
    if (index >= harnessPolicy.boundaryRowsPerBatch) return draft
    const [calendarId, id] = JSON.parse(draft.sourceEventId)
    const row = { calendarId, id, locale: draft.locale, star: 3, pubTimestamp: Date.parse(draft.scheduledAt!),
      calendarName: 'é'.repeat(512), countryName: 'é'.repeat(512), estimateValue: 'é'.repeat(512),
      preValue: 'é'.repeat(512), pubValue: 'é'.repeat(512), dataEffect: 'é'.repeat(512), dataEffectCode: 'c' }
    const parse = () => {
      const result = parseZeroXRouterEconomicData({ code: 200, msg: '', data: [row] }, draft.locale)
      if (result.state !== 'succeeded' || result.drafts.length !== 1) throw new Error('mixed-parser-failed')
      return result
    }
    const preliminary = prepareMarketCollection({ ...batch, parseResult: parse() }, context).observations[0]!
    const codeBytes = 1 + storagePolicy.observationBytes - Buffer.byteLength(JSON.stringify(preliminary))
    if (codeBytes < 1 || codeBytes > 1024) throw new Error('mixed-calibration-failed')
    row.dataEffectCode = 'é'.repeat(Math.floor(codeBytes / 2)) + (codeBytes % 2 ? 'c' : '')
    return parse().drafts[0]!
  })
  const mixed = { ...batch, parseResult: { ...batch.parseResult, drafts } }
  const distribution = { longRows: 0, shortRows: 0, minSerializedBytes: Infinity, maxSerializedBytes: 0 }
  prepareMarketCollection(mixed, context, row => {
    const bytes = Buffer.byteLength(JSON.stringify(row))
    const index = distribution.longRows + distribution.shortRows
    if (index < harnessPolicy.boundaryRowsPerBatch ? bytes !== storagePolicy.observationBytes : bytes >= storagePolicy.observationBytes) throw new Error('mixed-byte-distribution')
    if (index < harnessPolicy.boundaryRowsPerBatch) distribution.longRows++
    else distribution.shortRows++
    distribution.minSerializedBytes = Math.min(distribution.minSerializedBytes, bytes)
    distribution.maxSerializedBytes = Math.max(distribution.maxSerializedBytes, bytes)
  })
  if (distribution.longRows !== harnessPolicy.boundaryRowsPerBatch || distribution.shortRows !== harnessPolicy.batchRows - harnessPolicy.boundaryRowsPerBatch) throw new Error('mixed-row-count')
  return { input: mixed, distribution }
}
async function measure(scale: number, workload: string) {
  const runner = 'standard-node-no-profiler'
  const batches = scale / harnessPolicy.batchRows
  const samples: Array<{ stage: string } & NodeJS.MemoryUsage & { processMaxRssKiB: number }> = []
  const baseline = process.memoryUsage()
  const startupMaxRssKiB = process.resourceUsage().maxRSS
  const cpuStart = process.cpuUsage()
  const started = performance.now()
  const timings: { prepareMs: number; transactionMs: number; totalMs: number }[] = []
  const queryTimes: number[] = []
  const startupTimes: number[] = []
  const distribution = { longRows: 0, shortRows: 0, minSerializedBytes: Infinity, maxSerializedBytes: 0 }
  let replayInput: BatchInput
  let batchStart = 0, beginAt = 0, commitAt = 0
  let peak = baseline.rss
  let peakStage = 'startup'
  const sample = (stage: string) => {
    const memory = process.memoryUsage()
    if (memory.rss > peak) { peak = memory.rss; peakStage = stage }
    samples.push({ stage, ...memory, processMaxRssKiB: process.resourceUsage().maxRSS })
  }
  const observePeak = sample
  sample('startup')
  const directory = mkdtempSync(join(tmpdir(), 'mc3-isolated-performance-'))
  const path = `${directory}/isolated.sqlite`
  const volume = statfsSync(directory)
  const expected = scale * harnessPolicy.projectedBytesPerRow
  if (expected > storagePolicy.marketBytes || volume.bavail * volume.bsize < expected + harnessPolicy.preflightSpareBytes) throw new Error('resource-preflight')
  const preflight = { expectedBytes: expected, freeBytes: volume.bavail * volume.bsize }
  let db: DatabaseSync | undefined
  let repository: ReturnType<typeof createMarketCalendarEventRepository> | undefined
  let options: Parameters<typeof createMarketCalendarEventRepository>[0] | undefined
  let parsed: ReturnType<typeof parseZeroXRouterEconomicData> | undefined
  try {
    db = new DatabaseSync(path)
    db.exec('pragma journal_mode=wal; pragma foreign_keys=on')
    const execute = db.exec.bind(db)
    db.exec = (sql: string) => {
      if (sql === 'begin immediate') { beginAt = performance.now(); sample('prepared-before-begin') }
      const result = execute(sql)
      if (sql === 'commit') { commitAt = performance.now(); sample('committed') }
      return result
    }
    const settings = Object.fromEntries(['journal_mode', 'foreign_keys', 'cache_size', 'page_size', 'mmap_size', 'synchronous', 'wal_autocheckpoint', 'busy_timeout']
      .map((name) => [name, db!.prepare(`pragma ${name}`).get()]))

    const scope = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', month: '2026-09' }
    const detectedAt = '2026-09-08T00:00:00.000Z'
    const contexts = new Map<string, typeof scope>()
    options = { database: db, now: () => detectedAt, cursorKey: Buffer.alloc(32, 4),
      readCapacity: () => {
        const disk = statfsSync(directory)
        let walBytes = 0
        try { walBytes = statSync(`${path}-wal`).size } catch {}
        return { marketBytes: Number(db!.prepare('pragma page_count').get()?.page_count) * Number(db!.prepare('pragma page_size').get()?.page_size),
          walBytes, freeBytes: disk.bavail * disk.bsize, archiveAvailable: true }
      },
      resolveCollectionContext: (id) => {
        const source = contexts.get(id) ?? scope
        return { ...source, detectedAt, evidence: { providerId: '0xrouter', descriptorId: source.descriptorId,
          rawRecordId: 'derived-evidence', evidenceHash: 'a'.repeat(64) } }
      } }
    repository = createMarketCalendarEventRepository(options)
    sample('schema-ready')
    parsed = parseZeroXRouterEconomicData({ code: 200, msg: '', data: Array.from({ length: harnessPolicy.batchRows }, (_, index) => ({
      calendarId: 'synthetic', id: index + 1, calendarName: 'Derived '.repeat(50), locale: 'zh', star: 3,
      pubTimestamp: Date.parse('2026-09-09T12:00:00.000Z'), countryName: 'Derived country '.repeat(20),
      estimateValue: '0', preValue: 'Previous '.repeat(40), pubValue: 'Actual '.repeat(45)
    })) }, 'zh')
    if (parsed.state !== 'succeeded') throw new Error('derived-parser-failed')
    sample('parsed')
    for (const [id, data] of [['empty', []], ['skipped', [{}]], ['partial', [{}, { calendarId: 'derived', id: 1,
      calendarName: 'Derived', locale: 'zh', star: 1, pubTime: Date.parse(detectedAt) }]]] as const) {
      const result = repository.appendCollection({ ...scope, collectionId: id, parserVersion: 'mc2-derived',
        parseResult: parseZeroXRouterEconomicData({ code: 200, msg: '', data }, 'zh') })
      if (result.state !== 'succeeded') throw new Error(result.failureCode)
    }
    sample('write-baseline')
    for (let index = 0; index < batches; index++) {
      const collectionId = `synthetic-${String(index).padStart(8, '0')}`
      const english = index % harnessPolicy.localePeriod === harnessPolicy.localePeriod - 1
      const source = { ...scope, locale: english ? 'en' : 'zh' }
      contexts.set(collectionId, source)
      const parseResult = english ? { ...parsed, drafts: parsed.drafts.map((draft) => ({ ...draft, locale: 'en' as const,
        marketFactKey: JSON.stringify(['0xrouter', scope.descriptorId, 'en', draft.sourceEventId]) })) } : parsed
      let input = { ...source, collectionId, parserVersion: 'mc2-derived', parseResult }
      if (workload === 'representative-mixed') {
        const mixed = representativeMixedBatch(input, options.resolveCollectionContext!(collectionId)!)
        input = { ...input, parseResult: mixed.input.parseResult }
        distribution.longRows += mixed.distribution.longRows
        distribution.shortRows += mixed.distribution.shortRows
        distribution.minSerializedBytes = Math.min(distribution.minSerializedBytes, mixed.distribution.minSerializedBytes)
        distribution.maxSerializedBytes = Math.max(distribution.maxSerializedBytes, mixed.distribution.maxSerializedBytes)
      }
      if (index === 0) replayInput = input
      batchStart = performance.now()
      const result = repository.appendCollection(input)
      timings.push({ prepareMs: beginAt - batchStart, transactionMs: commitAt - beginAt, totalMs: performance.now() - batchStart })
      contexts.delete(collectionId)
      if (result.state !== 'succeeded') throw new Error(result.failureCode)
      observePeak(`batch-${index + 1}`)
      if ((index + 1) % 100 === 0 || [1, 10, 25, 50].includes(index + 1)) sample(`batch-${index + 1}`)
    }
    // Exact replay is actual repository work and included in the lifetime gate.
    const replayStart = performance.now()
    const replay = repository.appendCollection(replayInput)
    if (replay.state !== 'succeeded' || replay.inserted) throw new Error('replay-failed')
    const replayMs = performance.now() - replayStart
    sample('exact-replay')
    for (let index = 0; index < harnessPolicy.queryPairs; index++) {
      const startupStart = performance.now()
      let fresh = createMarketCalendarEventRepository(options)
      startupTimes.push(performance.now() - startupStart)
      observePeak(`recreate-${index + 1}`)
      const queryStart = performance.now()
      const a = fresh.listCollections({ ...scope, asOf: detectedAt })
      observePeak(`collections-${index + 1}`)
      const b = fresh.listObservations({ ...scope, asOf: detectedAt, collectionId: 'synthetic-00000000' })
      observePeak(`observations-${index + 1}`)
      if (a.state !== 'succeeded' || b.state !== 'succeeded') throw new Error('query-failed')
      queryTimes.push(performance.now() - queryStart)
      fresh = undefined as never
    }
    sample('queries-complete')
    repository = undefined
    options = undefined
    parsed = undefined
    replayInput = undefined
    contexts.clear()
    sample('references-released')
    await new Promise<void>((resolve) => setImmediate(resolve))
    sample('event-loop-after-release')
    const beforeClose = statSync(path).size
    const walBeforeCheckpoint = statSync(path + '-wal').size
    const count = db.prepare('select count(*) as count from mi_macro_calendar_market_event_observations').get()
    if (Number(count?.count) !== scale + 1) throw new Error('observation-count')
    // Bounded object-size summary, no observation materialization.
    let storageObjects: unknown
    try {
      storageObjects = db.prepare('select name, sum(pgsize) as bytes from dbstat group by name').all()
    } catch { storageObjects = 'dbstat-unavailable' }
    sample('storage-size-summary')
    db.exec('pragma wal_checkpoint(truncate)')
    sample('checkpoint-complete')
    db.close()
    db = undefined
    sample('db-closed')
    await new Promise<void>((resolve) => setImmediate(resolve))
    sample('event-loop-after-close')
    db = new DatabaseSync(path)
    sample('reopened')
    const reopenStartupStart = performance.now()
    const reopened = createMarketCalendarEventRepository({ database: db, cursorKey: Buffer.alloc(32, 4) })
    const reopenStartupMs = performance.now() - reopenStartupStart
    const reopenedPage = reopened.listCollections({ ...scope, asOf: detectedAt })
    if (reopenedPage.state !== 'succeeded') throw new Error('reopen-query-failed')
    sample('reopen-query')
    db.close()
    db = undefined
    sample('reopen-closed')
    // Capture the gate before p95 sorting, report formatting, cleanup or exit.
    const finalResource = process.resourceUsage()
    const finalMemory = process.memoryUsage()
    const finalCpu = process.cpuUsage(cpuStart)
    const elapsedMs = performance.now() - started
    const p95 = (values: number[]) => values.sort((a,b) => a-b)[Math.floor(values.length * .95)]
    const report = {
      cpu: finalCpu, elapsedMs, replayMs, storageObjects, walBeforeCheckpoint,
      startupP95Ms: p95(startupTimes), startupSamples: startupTimes.length, reopenStartupMs,
      reopenStartupMeaning: 'single reconstruction after reopen; not cold-start p95',
      prepareP95Ms: p95(timings.map(t => t.prepareMs)), transactionP95Ms: p95(timings.map(t => t.transactionMs)),
      totalP95Ms: p95(timings.map(t => t.totalMs)), queryPairP95Ms: p95(queryTimes),
      allocationProfiling: 'disabled; no inspector session or profile export'
    }
    process.stdout.write(JSON.stringify({ runner, preflight, settings }) + '\n')
    for (const value of samples) process.stdout.write(JSON.stringify({ runner, batches, ...value }) + '\n')
    process.stdout.write(JSON.stringify({ runner, report }) + '\n')
    process.stdout.write(JSON.stringify({ runner, summary: { batches, generatedObservations: scale + 1,
      workload, distribution: workload === 'representative-mixed' ? distribution : undefined,
      startupBudgetMs: harnessPolicy.startupP95Ms, withinStartupBudget: report.startupP95Ms! <= harnessPolicy.startupP95Ms,
      queryPairs: harnessPolicy.queryPairs, dbBytes: beforeClose, peakRss: peak, peakStage, startupRss: baseline.rss,
      startupDeltaRss: peak - baseline.rss,
      postParseDeltaRss: peak - Number(samples.find(s => s.stage === 'parsed')!.rss),
      writeBaselineDeltaRss: peak - Number(samples.find(s => s.stage === 'write-baseline')!.rss),
      startupMaxRssKiB, finalMemory,
      lifecycleDeltaBytes: finalResource.maxRSS * 1024 - baseline.rss,
      rssBudgetBytes: harnessPolicy.maximumRssIncrement,
      withinRssBudget: finalResource.maxRSS * 1024 - baseline.rss <= harnessPolicy.maximumRssIncrement,
      processMaxRssKiB: finalResource.maxRSS, forcedGc: false, profiler: false } }) + '\n')
    if (finalResource.maxRSS * 1024 - baseline.rss > harnessPolicy.maximumRssIncrement ||
      report.startupP95Ms! > harnessPolicy.startupP95Ms ||
      report.totalP95Ms! > harnessPolicy.batchP95Ms || report.queryPairP95Ms! > harnessPolicy.queryP95Ms) process.exitCode = 1
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scale = Number(process.argv[2])
  const workload = process.argv[3] ?? 'standard'
  if (process.versions.node.split('.')[0] !== harnessPolicy.nodeMajor ||
    !process.execArgv.includes('--import') || !process.execArgv.includes('tsx') ||
    !harnessPolicy.scales.includes(scale) || !['standard', 'representative-mixed'].includes(workload) ||
    process.argv.length < 3 || process.argv.length > 4) {
    throw new Error('Use Node 22: node --import tsx <harness.mts> 100000|1000000 [standard|representative-mixed]')
  }
  await measure(scale, workload)
}
