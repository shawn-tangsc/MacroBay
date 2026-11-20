import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { payloadHash, readPayload, resolvePayloadDirectory, writeVerifiedPayload } from './contentAddressedPayloads'

/**
 * 内容寻址原语（用户 2026-11-20）：日历与通用采集共用一份写/读实现。
 * 判据：文件名就是 hash、写后读回校验、同 hash 复用不覆盖、读不到与 hash 不符分开报。
 */
let directory = ''
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'payloads-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

const body = '{"value":1}'
const hash = payloadHash(body)

describe('内容寻址原语', () => {
  it('写入用内容哈希命名；同一内容第二次是复用、不覆盖', () => {
    const first = writeVerifiedPayload({ directory, body, expectedHash: hash, temporarySequence: 1 })
    expect(first).toEqual({ state: 'written', fileRef: `${hash}.bin` })
    expect(readFileSync(join(directory, `${hash}.bin`), 'utf8')).toBe(body)
    expect(writeVerifiedPayload({ directory, body, expectedHash: hash, temporarySequence: 2 }))
      .toEqual({ state: 'reused', fileRef: `${hash}.bin` })
  })

  it('hash 不符写前就拒；读回被篡改的内容报 hash-mismatch，不是「没有」', () => {
    expect(writeVerifiedPayload({ directory, body, expectedHash: payloadHash('other'), temporarySequence: 1 }))
      .toEqual({ state: 'failed', reason: 'hash-mismatch' })
    writeFileSync(join(directory, `${hash}.bin`), 'tampered', 'utf8')
    expect(readPayload({ directory, fileRef: `${hash}.bin`, expectedHash: hash })).toEqual({ state: 'hash-mismatch' })
    expect(readPayload({ directory, fileRef: `${hash}.bin` })).toEqual({ state: 'found', body: 'tampered' })
  })

  it('文件不在报 missing；非法文件名不读', () => {
    expect(readPayload({ directory, fileRef: `${hash}.bin`, expectedHash: hash })).toEqual({ state: 'missing' })
    expect(readPayload({ directory, fileRef: '../etc/passwd' })).toEqual({ state: 'missing' })
  })

  it('owner → 目录是一张表：只认登记过的 owner', () => {
    expect(resolvePayloadDirectory('macro-calendar', '/d')).toBe('/d/macro-calendar-evidence')
    expect(resolvePayloadDirectory('generic-intelligence', '/d')).toBe('/d/intelligence-payloads/generic-intelligence')
    expect(resolvePayloadDirectory('someone-else', '/d')).toBeUndefined()
  })
})
