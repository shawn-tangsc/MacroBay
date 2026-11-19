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

  /**
   * **原文外置已退休**（用户 2026-11-20，方案 A）：raw record 的原文只由「写路径 + 内容寻址原语」写。
   * 这条用例原先断的是「大 payload 会被挪成 file 引用」——那个行为已经有意删掉（它就是 36MB 的根因：
   * 4096 阈值 + 500 条窗口让它几乎永远不触发，且写入的还是非内容寻址命名）。
   *
   * 现在断的是**反面**：跑这个任务之后，记录**一个字节都不该变**。
   * 覆盖搬家：`rawRecordStore.writePath.test.ts`（写路径一律 file、不落 body）与
   * `rawRecordPayloadLayout.test.ts`（目录由 owner 唯一决定）。
   */
  it('不再碰 raw record 的原文引用（原文外置已退休，只做译文压缩）', async () => {
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

    expect(result.archivedCount).toBe(0)
    const unchanged = rawRecordStore.getRawRecord(record.rawRecordId)
    expect(unchanged?.payloadRefType).toBe('inline')
    expect(unchanged?.payloadBody).toBe(largeBody)
    expect(unchanged?.payloadFileRef).toBeUndefined()
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
