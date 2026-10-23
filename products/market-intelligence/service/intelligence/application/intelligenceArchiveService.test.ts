import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRawRecordStore } from './rawRecordStore'
import { createIntelligenceArchiveService, resolveHotRetentionDays } from './intelligenceArchiveService'

describe('intelligenceArchiveService', () => {
  it('resolves different hot retention windows by retention mode', () => {
    expect(resolveHotRetentionDays('compact')).toBeLessThan(resolveHotRetentionDays('balanced'))
    expect(resolveHotRetentionDays('balanced')).toBeLessThan(resolveHotRetentionDays('extended'))
  })

  it('moves large raw payloads to file-backed archive refs while keeping metadata queryable', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'intel-archive-'))
    const rawRecordStore = createRawRecordStore()
    const largeBody = 'x'.repeat(8_192)
    const record = rawRecordStore.appendRawRecord({
      sourceId: 'coindesk-rss',
      runId: 'run-1',
      sourceDedupeKey: 'dedupe-1',
      payloadFormat: 'rss-item',
      payloadRefType: 'inline',
      payloadBody: largeBody,
      payloadHash: 'hash-1',
      payloadSizeBytes: largeBody.length,
      parserVersion: 'v1'
    })!

    const service = createIntelligenceArchiveService({ rawRecordStore, archiveBaseDir: baseDir })
    const result = await service.compactSource({ sourceId: 'coindesk-rss', retentionMode: 'compact' })

    expect(result.archivedCount).toBe(1)
    const updated = rawRecordStore.getRawRecord(record.rawRecordId)
    expect(updated?.payloadRefType).toBe('file')
    expect(updated?.payloadBody).toBeUndefined()
    expect(updated?.archiveStatus).toBe('archived')
    expect(updated?.storageTier).toBe('warm')

    const archivedFile = join(baseDir, 'coindesk-rss', updated!.payloadFileRef!)
    const archivedBytes = await readFile(archivedFile, 'utf8')
    expect(archivedBytes).toBe(largeBody)
  })

  it('is idempotent when archive already applied', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'intel-archive-'))
    const rawRecordStore = createRawRecordStore()
    rawRecordStore.appendRawRecord({
      sourceId: 'coindesk-rss',
      runId: 'run-1',
      sourceDedupeKey: 'dedupe-2',
      payloadFormat: 'rss-item',
      payloadRefType: 'inline',
      payloadBody: 'y'.repeat(8_192),
      payloadHash: 'hash-2',
      payloadSizeBytes: 8192,
      parserVersion: 'v1',
      archiveStatus: 'archived',
      storageTier: 'warm',
      payloadFileRef: 'existing.bin'
    })

    const service = createIntelligenceArchiveService({ rawRecordStore, archiveBaseDir: baseDir })
    const first = await service.compactSource({ sourceId: 'coindesk-rss', retentionMode: 'balanced' })
    const second = await service.compactSource({ sourceId: 'coindesk-rss', retentionMode: 'balanced' })

    expect(first.archivedCount).toBe(0)
    expect(second.archivedCount).toBe(0)
  })

  it('does not archive macro-calendar raw records through the generic archive path', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'intel-archive-'))
    const rawRecordStore = createRawRecordStore()
    const macro = rawRecordStore.appendRawRecord({
      sourceId: 'macro-calendar-bls', runId: 'run-macro', sourceDedupeKey: 'macro-archive-1',
      payloadFormat: 'json', payloadRefType: 'inline', payloadBody: 'x'.repeat(8_192),
      payloadHash: 'macro-hash', payloadSizeBytes: 8_192, parserVersion: 'fixture-v1', processingOwner: 'macro-calendar'
    })!

    const service = createIntelligenceArchiveService({ rawRecordStore, archiveBaseDir: baseDir })
    expect(await service.compactSource({ sourceId: 'macro-calendar-bls', retentionMode: 'compact' })).toMatchObject({ archivedCount: 0 })
    expect(rawRecordStore.getRawRecord(macro.rawRecordId)?.payloadBody).toHaveLength(8_192)
  })

  it('does not archive retired DeFiLlama stablecoin raw records through the generic archive path', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'intel-archive-'))
    const rawRecordStore = createRawRecordStore()
    const legacy = rawRecordStore.appendRawRecord({
      sourceId: 'defillama-stablecoins', runId: 'legacy-run', sourceDedupeKey: 'legacy-stablecoins',
      payloadFormat: 'json', payloadRefType: 'inline', payloadBody: 'x'.repeat(8_192),
      payloadHash: 'legacy-hash', payloadSizeBytes: 8_192, parserVersion: 'metric-rest-api-v1'
    })!

    const service = createIntelligenceArchiveService({ rawRecordStore, archiveBaseDir: baseDir })

    expect(await service.compactSource({ sourceId: 'defillama-stablecoins', retentionMode: 'compact' })).toMatchObject({ archivedCount: 0 })
    expect(rawRecordStore.getRawRecord(legacy.rawRecordId)?.payloadBody).toHaveLength(8_192)
  })
})
