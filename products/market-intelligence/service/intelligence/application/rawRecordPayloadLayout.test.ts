import { describe, expect, it } from 'vitest'

import { payloadLocationOf, rawPayloadDirectoryFor, RAW_PAYLOAD_DIRECTORIES } from './rawRecordPayloadLayout'

/**
 * 目录由 owner 唯一决定（用户 2026-11-20 定）：日历不搬、通用走新目录，**不许按新旧猜**。
 * 读路径的四种结果也必须分开——`body-missing` 不许退化成空 body。
 */
describe('原文目录与读取位置', () => {
  const base = { dataDir: '/data', calendarEvidenceDir: '/data/products/mi/macro-calendar-evidence' } as const

  it('owner → 目录是一张两行的表，日历用既有目录、通用用新目录', () => {
    expect(RAW_PAYLOAD_DIRECTORIES).toEqual({ 'macro-calendar': 'calendar-evidence', 'generic-intelligence': 'payload-store' })
    expect(rawPayloadDirectoryFor({ owner: 'macro-calendar', ...base })).toBe(base.calendarEvidenceDir)
    expect(rawPayloadDirectoryFor({ owner: 'generic-intelligence', ...base })).toBe('/data/intelligence-payloads/generic-intelligence')
  })

  it('file 引用落在 owner 对应的目录里（同一个 fileRef 在两个 owner 下指向不同路径，这是有意的）', () => {
    const file = { payloadRefType: 'file' as const, payloadFileRef: 'abc.bin' }
    expect(payloadLocationOf({ owner: 'macro-calendar', ...file, ...base })).toEqual({
      kind: 'file', fileRef: 'abc.bin', directory: base.calendarEvidenceDir
    })
    expect(payloadLocationOf({ owner: 'generic-intelligence', ...file, ...base })).toEqual({
      kind: 'file', fileRef: 'abc.bin', directory: '/data/intelligence-payloads/generic-intelligence'
    })
  })

  it('inline 读自带 body；缺 body / 缺引用各自是独立结果，不退化成空 body', () => {
    expect(payloadLocationOf({ owner: 'generic-intelligence', payloadRefType: 'inline', payloadBody: '{}', ...base }))
      .toEqual({ kind: 'inline', body: '{}' })
    expect(payloadLocationOf({ owner: 'generic-intelligence', payloadRefType: 'inline', ...base }).kind).toBe('body-missing')
    expect(payloadLocationOf({ owner: 'generic-intelligence', payloadRefType: 'file', ...base }).kind).toBe('ref-missing')
  })
})
