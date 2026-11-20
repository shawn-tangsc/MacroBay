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
  /**
   * 读旧布局的原文（老实现按 `archiveBaseDir/<sourceId>/` 存、命名不是内容寻址）。
   * 只有「file 但引用不是 `<64 hex>.bin`」的记录才会用到；读不到就报未迁移，不猜。
   */
  readOldLayoutPayload?: (fileRef: string) => string | undefined
}>

export type ExternalizeResult<T extends ExternalizableRecord> = Readonly<{
  records: readonly T[]
  /** `inline → file` 的条数。 */
  inlineToFile: number
  /** **老布局 → 新布局**的条数（本机预期 0：老实现一条都没外置过）。 */
  relocatedFromOldLayout: number
  /** hash 校验失败 / 读不到 / 写入失败的条数：原地不动。 */
  untouched: number
  /** 已经是内容寻址引用的条数，本轮跳过。 */
  alreadyContentAddressed: number
}>

/** 内容寻址的引用长这样：`<64 位小写 hex>.bin`。不符合的一律按**老布局**处理。 */
export function isContentAddressedPayloadRef(fileRef: string): boolean {
  return /^[0-9a-f]{64}\.bin$/.test(fileRef)
}

export function externalizeInlinePayloads<T extends ExternalizableRecord>(
  input: Readonly<{ records: readonly T[]; deps: ExternalizeDeps }>
): ExternalizeResult<T> {
  let inlineToFile = 0
  let relocatedFromOldLayout = 0
  let untouched = 0
  let alreadyContentAddressed = 0
  const records = input.records.map((record): T => {
    if (record.payloadRefType !== 'inline') {
      const ref = record.payloadFileRef ?? ''
      /* 已经是内容寻址（新布局）：跳过。引用不像 `<hex>.bin` 的，是**老布局**——必须重新安家，
         否则新读路径按 owner 目录表去找，它会变成「读不到」。 */
      if (isContentAddressedPayloadRef(ref)) { alreadyContentAddressed += 1; return record }
      const body = input.deps.readOldLayoutPayload?.(ref)
      if (body === undefined || record.payloadHash === '') { untouched += 1; return record }
      const fileRef = input.deps.writeVerifiedPayload({ body, expectedHash: record.payloadHash })
      if (fileRef === undefined) { untouched += 1; return record }
      relocatedFromOldLayout += 1
      return { ...record, payloadFileRef: fileRef } as T
    }
    const body = record.payloadBody
    // 没有 body 或没有 hash：无从校验，原地不动（不猜、不编）。
    if (body === undefined || record.payloadHash === '') { untouched += 1; return record }
    const fileRef = input.deps.writeVerifiedPayload({ body, expectedHash: record.payloadHash })
    // 原语校验没过（hash 不符 / 写失败）：这条原地不动——**不许半搬**。
    if (fileRef === undefined) { untouched += 1; return record }
    inlineToFile += 1
    const { payloadBody: _dropped, ...rest } = record
    return { ...rest, payloadRefType: 'file' as const, payloadFileRef: fileRef } as T
  })
  return { records, inlineToFile, relocatedFromOldLayout, untouched, alreadyContentAddressed }
}
