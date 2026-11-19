import { join } from 'node:path'

import type { RawProcessingOwner } from '../schema/intelligenceRecord'

/**
 * 原文所在的目录**由 owner 唯一决定**（架构师文档 §2，用户 2026-11-20 定）：
 * 日历的 625 条原文已经在 `macro-calendar-evidence/` 里（`payloadRefType:'file'`），**不搬**；
 * 通用采集走新目录。
 *
 * **不许按「新旧」或「有没有 payloadFileRef」猜目录**——同一条引用要是可能指向两个地方，
 * 读的时候就得 try 两个目录，那是最难查的一类 bug。这里一张表，只查它。
 */
export const RAW_PAYLOAD_DIRECTORIES: Readonly<Record<RawProcessingOwner, 'calendar-evidence' | 'payload-store'>> = Object.freeze({
  'macro-calendar': 'calendar-evidence',
  'generic-intelligence': 'payload-store'
})

/** 目录解析只在这里：`calendar-evidence` 用既有目录，其余落在 `intelligence-payloads/<owner>/`。 */
export function rawPayloadDirectoryFor(input: Readonly<{
  owner: RawProcessingOwner
  dataDir: string
  calendarEvidenceDir: string
}>): string {
  return RAW_PAYLOAD_DIRECTORIES[input.owner] === 'calendar-evidence'
    ? input.calendarEvidenceDir
    : join(input.dataDir, 'intelligence-payloads', input.owner)
}

/**
 * 一条记录去哪里找原文（读路径的唯一判别位，不看 schemaVersion）。
 *
 * 四种结果分开，**不许把「读不到」退化成空 body**（那等于把「读不到」画成「没有」）：
 * `inline` → 记录自带 body；`file` → 由调用方用注入的 `readPayload` 读文件并校验 hash；
 * `body-missing` / `ref-missing` → 这条记录本身缺字段（数据问题，报读不到）。
 */
export type RawPayloadLocation =
  | Readonly<{ kind: 'inline'; body: string }>
  | Readonly<{ kind: 'file'; fileRef: string; directory: string }>
  | Readonly<{ kind: 'body-missing' }>
  | Readonly<{ kind: 'ref-missing' }>

export function payloadLocationOf(input: Readonly<{
  owner: RawProcessingOwner
  payloadRefType: 'inline' | 'file'
  payloadBody?: string
  payloadFileRef?: string
  dataDir: string
  calendarEvidenceDir: string
}>): RawPayloadLocation {
  if (input.payloadRefType === 'inline') {
    return input.payloadBody === undefined ? { kind: 'body-missing' } : { kind: 'inline', body: input.payloadBody }
  }
  if (input.payloadFileRef === undefined || input.payloadFileRef === '') return { kind: 'ref-missing' }
  return {
    kind: 'file',
    fileRef: input.payloadFileRef,
    directory: rawPayloadDirectoryFor({ owner: input.owner, dataDir: input.dataDir, calendarEvidenceDir: input.calendarEvidenceDir })
  }
}
