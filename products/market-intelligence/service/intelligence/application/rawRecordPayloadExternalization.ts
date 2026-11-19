/**
 * 存量原文外置（架构师 `raw-record-payload-externalization.md` §4，用户 2026-11-20）。
 *
 * **按缺口迁、不用版本标记**：非 `inline` 的记录原样留着；跑两遍第二遍 `0 变更`。
 * 原语（写文件 + 校验）由调用方注入——这里不碰文件系统，所以能在测试里用假实现把规则钉死：
 * 条数不变、引用可解析、hash 不符的那条**原地不动**（不许换引用，也不许删）。
 */
export type ExternalizableRecord = Readonly<{
  rawRecordId: string
  payloadRefType: 'inline' | 'file'
  payloadBody?: string
  payloadHash: string
  payloadFileRef?: string
}>

export type ExternalizeDeps = Readonly<{
  /** 注入的原语：写文件并校验；返回可用的引用，失败返回 undefined。 */
  writeVerifiedPayload: (input: Readonly<{ body: string; expectedHash: string }>) => string | undefined
}>

export type ExternalizeResult<T extends ExternalizableRecord> = Readonly<{
  records: readonly T[]
  /** 这次真正换掉引用的条数（不含已经是 file 的）。 */
  externalized: number
  /** hash 校验失败 / 写入失败的条数：原地不动。 */
  untouched: number
  /** 已经是 file、本轮跳过的条数。 */
  alreadyFile: number
}>

export function externalizeInlinePayloads<T extends ExternalizableRecord>(
  input: Readonly<{ records: readonly T[]; deps: ExternalizeDeps }>
): ExternalizeResult<T> {
  let externalized = 0
  let untouched = 0
  let alreadyFile = 0
  const records = input.records.map((record): T => {
    if (record.payloadRefType !== 'inline') { alreadyFile += 1; return record }
    const body = record.payloadBody
    // 没有 body 或没有 hash：无从校验，原地不动（不猜、不编）。
    if (body === undefined || record.payloadHash === '') { untouched += 1; return record }
    const fileRef = input.deps.writeVerifiedPayload({ body, expectedHash: record.payloadHash })
    // 原语校验没过（hash 不符 / 写失败）：这条原地不动——**不许半搬**。
    if (fileRef === undefined) { untouched += 1; return record }
    externalized += 1
    const { payloadBody: _dropped, ...rest } = record
    return { ...rest, payloadRefType: 'file' as const, payloadFileRef: fileRef } as T
  })
  return { records, externalized, untouched, alreadyFile }
}
