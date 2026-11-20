import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intelligence-module-stores-test' },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import { createIntelligenceStores } from './intelligenceModuleStores'

/**
 * M2 抽出来的这一段自己的用例（2026-11-15 拆分 `intelligenceModule.ts`）。
 *
 * 这一段最危险的坏法**不会报任何错**：存储路径被改一个字（`intelligence-raw-records.json` 少个 s），
 * 程序照常启动，读者的历史记录静默丢失。所以判据不是「字段都在」，而是
 * **同一个 dataDir 上第二个工厂读得到第一个工厂写下的东西**——路径漂了这一步就红。
 *
 * 第二件事：工厂返回的键就是调用方要用的那些，多一个少一个都说明接线搬家时错位了。
 */
const directories: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mi-stores-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
  directories.length = 0
})

function stores(overrides: { dataDir: string; withEventBus?: boolean }) {
  return createIntelligenceStores({
    dataDir: overrides.dataDir,
    getAppLanguage: async () => 'zh-CN' as const,
    timeZone: () => 'UTC',
    ...(overrides.withEventBus === true ? { eventBusRuntime: { emit: vi.fn() } as never } : {}),
    log: vi.fn()
  })
}

describe('intelligenceModule 存储段', () => {
  it('同一个 dataDir 上，第二个工厂读得到第一个工厂写下的原始记录（路径没有漂）', () => {
    const dataDir = tempDir()
    const first = stores({ dataDir })
    const appended = first.rawRecordStore.appendRawRecord({
      sourceId: 'macro-calendar-bls',
      runId: 'run-1',
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody: '{"ok":true}',
      payloadHash: createHash('sha256').update('{"ok":true}').digest('hex'),
      sourceDedupeKey: 'bls-2026-11',
      parserVersion: 'v1'
    })
    expect(appended?.rawRecordId).toBeTruthy()
    expect(existsSync(join(dataDir, 'intelligence-raw-records.json'))).toBe(true)

    // 新工厂 = 一次真实重启：它只从 dataDir 里读，读不到就是路径变了。
    const second = stores({ dataDir })
    expect(second.rawRecordStore.getRawRecord(appended!.rawRecordId)).toMatchObject({
      sourceId: 'macro-calendar-bls',
      sourceDedupeKey: 'bls-2026-11'
    })
    expect(second.rawRecordStore.listUnprocessed()).toHaveLength(1)
  })

  it('返回的就是下游要用的那几个值，不多不少', () => {
    const created = stores({ dataDir: tempDir() })
    expect(Object.keys(created).sort()).toEqual([
      'credentialStore',
      'fetchText',
      'macroCalendarEvidenceArchive',
      'macroCalendarEvidenceMigration',
      'macroMarketStore',
      'pipeline',
      'profileStore',
      'rawRecordStore',
      'translationStorage'
    ])
    // 证据归档的迁移结果是装配对象里的一项事实（`macroCalendarEvidenceReady` 由它派生）。
    expect(typeof created.macroCalendarEvidenceMigration.state).toBe('string')
    // 采集 pipeline 已经可用（它的运行态就是来源健康那一路的输入）。
    expect(Array.isArray(created.pipeline.listRuntimeStates())).toBe(true)
    expect(typeof created.fetchText).toBe('function')
  })
})

/**
 * 原文外置**必须真的接上**（用户 2026-11-20）：`payloadDirectory` / `writeVerifiedPayload` 少一个，
 * `appendRawRecord` 就静默回退到内联，JSON 照旧涨、没有任何报错。这条用例就是防那种静默失败。
 */
describe('原文外置的注入', () => {
  it('生产装配下新写入一律落成 file 引用，且记录里没有 payloadBody', () => {
    const dataDir = tempDir()
    const created = stores({ dataDir })
    const record = created.rawRecordStore.appendRawRecord({
      sourceId: 'binance-announcements',
      runId: 'run-inline',
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody: '{"body":"inline"}',
      payloadHash: createHash('sha256').update('{"body":"inline"}').digest('hex'),
      sourceDedupeKey: 'inline-1',
      parserVersion: 'v1'
    })!
    expect(record.payloadRefType).toBe('file')
    expect(record.payloadFileRef).toMatch(/^[0-9a-f]{64}\.bin$/)
    expect('payloadBody' in record).toBe(false)
  })
})
