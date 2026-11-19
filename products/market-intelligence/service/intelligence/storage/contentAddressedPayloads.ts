import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **内容寻址的原文落盘原语**（用户 2026-11-20，架构师方案 §1）：日历档案已经做对了这件事
 * （`<sha256>.bin`、`wx` 临时文件 + `rename`、写后读回校验 hash 与字节数、同 hash 复用、失败清理），
 * 现在把它抽出来给通用采集共用——**全仓只此一份**，不再写第二个迁移脚本或第二份写实现。
 *
 * 三条不变量：
 * - 文件名就是内容哈希：同内容永远落到同一个文件，天然去重；
 * - **写后必须读回校验**（hash + 字节数）：写进去的和记录的必须是同一份；
 * - 读不到与 hash 不符**分开报**（`missing` / `hash-mismatch`），不许合并成「没有」。
 */
export const contentAddressedPayloadPolicy = Object.freeze({ filePattern: /^[a-f0-9]{64}\.bin$/ })

/** sha256（hex，小写）——文件名、记录里的 `payloadHash`、写后校验都用它，只有这一处口径。 */
export function payloadHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export type WriteVerifiedPayloadResult =
  | Readonly<{ state: 'written' | 'reused'; fileRef: string }>
  | Readonly<{ state: 'failed'; reason: 'hash-mismatch' | 'verify-failed' }>

/** 按内容寻址写入；已存在同 hash 文件时复用（不覆盖，仍做读回校验）。 */
export function writeVerifiedPayload(input: Readonly<{
  directory: string
  body: string
  expectedHash: string
  temporarySequence: number
}>): WriteVerifiedPayloadResult {
  if (payloadHash(input.body) !== input.expectedHash) return { state: 'failed', reason: 'hash-mismatch' }
  /* **目录由写入点自己建**（用户 2026-11-20）：原语返回 `failed` 时调用方的规则是「整条记录不落库」，
     所以目录缺失的后果不是「慢一点」，而是**静默丢数据**；而迁移是第二个调用方，漏建一次就是
     7654 条全变「未迁移」。前置条件归写入点自己负责，不让两个调用方各写一遍。 */
  try { mkdirSync(input.directory, { recursive: true }) } catch { return { state: 'failed', reason: 'verify-failed' } }
  const fileRef = `${input.expectedHash}.bin`
  const path = join(input.directory, fileRef)
  const existed = existsSync(path)
  const temporaryPath = `${path}.${process.pid}.${input.temporarySequence}.tmp`
  try {
    if (!existed) {
      writeFileSync(temporaryPath, input.body, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporaryPath, path)
    }
    const stored = readFileSync(path, 'utf8')
    const verified = payloadHash(stored) === input.expectedHash
      && Buffer.byteLength(stored, 'utf8') === Buffer.byteLength(input.body, 'utf8')
    return verified ? { state: existed ? 'reused' : 'written', fileRef } : { state: 'failed', reason: 'verify-failed' }
  } catch {
    return { state: 'failed', reason: 'verify-failed' }
  } finally {
    try { rmSync(temporaryPath, { force: true }) } catch { /* keep the original result */ }
  }
}

export type ReadPayloadResult =
  | Readonly<{ state: 'found'; body: string }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'hash-mismatch' }>

/** 读回并校验；`missing`（文件不在）与 `hash-mismatch`（在但内容不对）分开。 */
export function readPayload(input: Readonly<{
  directory: string
  fileRef: string
  expectedHash?: string
}>): ReadPayloadResult {
  if (!contentAddressedPayloadPolicy.filePattern.test(input.fileRef)) return { state: 'missing' }
  try {
    const body = readFileSync(join(input.directory, input.fileRef), 'utf8')
    if (input.expectedHash !== undefined && payloadHash(body) !== input.expectedHash) return { state: 'hash-mismatch' }
    return { state: 'found', body }
  } catch {
    return { state: 'missing' }
  }
}

/**
 * **owner → 原文目录（一张表）**：只查表，不猜、不 try 两个目录。
 * 日历沿用既有 `macro-calendar-evidence/`（那批 `file` 引用不搬）；通用采集用自己的目录。
 */
export function resolvePayloadDirectory(owner: string, dataDir: string): string | undefined {
  const byOwner: Readonly<Record<string, string>> = Object.freeze({
    'macro-calendar': 'macro-calendar-evidence',
    'generic-intelligence': 'intelligence-payloads/generic-intelligence'
  })
  const relative = byOwner[owner]
  return relative === undefined ? undefined : join(dataDir, relative)
}
