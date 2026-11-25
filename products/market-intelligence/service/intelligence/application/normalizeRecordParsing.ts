import type { IntelligenceSourceAdapter } from '../adapters/sourceAdapter'
import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'
import type { RawRecordPayloadRead } from './rawRecordStore'

/** 归一化前把一条原始记录变成「适配器认得的正文 + 解析结果」。失败不抛，交给调用方计数并继续。 */
export type NormalizedRecordParse =
  | Readonly<{
      state: 'parsed'
      parsed: ReturnType<IntelligenceSourceAdapter['parseRawRecord']>
      /** 真正交给解析器的正文（来自 inline 字段或内容寻址文件）。 */
      payloadBody: string
    }>
  | Readonly<{ state: 'failed'; marker: 'MI_NORMALIZE_PAYLOAD_UNREADABLE' | 'MI_NORMALIZE_RECORD_FAILED' }>

type ParseRawRecordInput = Parameters<IntelligenceSourceAdapter['parseRawRecord']>[0]

/**
 * 归一化的第一步：**先把原文读回来，再解析**。
 *
 * 三条事实都写在这一个函数里，因为它们其实是同一件事：
 *
 * 1. 原文外置（2026-11-20）之后正文只在内容寻址文件里、`payloadBody` 不落库。以前这里直接把
 *    `rawRecord.payloadBody`（恒为 undefined）交给适配器，每个源都以「解析失败」收场——RSS 报
 *    `No RSS items found`、Binance 报 `HTML parser not implemented`、DefiLlama 报
 *    `missing TVL total`。那是同一处空正文的三个症状，**解析器本身没有坏**。
 * 2. 读不到原文时 `missing`（文件不在）与 `hash-mismatch`（在但内容不对）分开报，都不当
 *    「没有原文」，更不许拿空串继续解析。
 * 3. 一条记录解析失败**不许挡住整队**（2026-11-21 事故）：记一条结构化日志、返回 `failed`，
 *    由调用方计入失败并继续处理下一条；坏记录留在待办里，下一轮重试。
 *
 * 指标窗口在这里一并交给 sink（它会自己解析来源字节），因为它读的正是这份刚读回的正文——
 * 放到调用方去传，等于把「读一次」变成「传两处」。
 */
export function parseRecordForNormalization(input: Readonly<{
  rawRecord: RawIntelligenceRecord
  adapter: Pick<IntelligenceSourceAdapter, 'parseRawRecord'>
  config: ParseRawRecordInput['config']
  readPayloadBody: (record: RawIntelligenceRecord) => RawRecordPayloadRead
  onMetricWindow?: (input: Readonly<{ sourceId: string; payloadBody: string; payloadMetaJson?: string }>) => void
}>): NormalizedRecordParse {
  const payload = input.readPayloadBody(input.rawRecord)
  if (payload.state === 'missing' || payload.state === 'hash-mismatch') {
    console.log(JSON.stringify({
      marker: 'MI_NORMALIZE_PAYLOAD_UNREADABLE',
      sourceId: input.rawRecord.sourceId,
      rawRecordId: input.rawRecord.rawRecordId,
      state: payload.state
    }))
    return { state: 'failed', marker: 'MI_NORMALIZE_PAYLOAD_UNREADABLE' }
  }
  const payloadBody = payload.body

  let parsed: ReturnType<IntelligenceSourceAdapter['parseRawRecord']>
  try {
    parsed = input.adapter.parseRawRecord({
      config: input.config,
      rawRecord: { ...input.rawRecord, payloadBody }
    })
  } catch (error) {
    console.log(JSON.stringify({
      marker: 'MI_NORMALIZE_RECORD_FAILED',
      sourceId: input.rawRecord.sourceId,
      rawRecordId: input.rawRecord.rawRecordId,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 200)
    }))
    return { state: 'failed', marker: 'MI_NORMALIZE_RECORD_FAILED' }
  }

  if (input.onMetricWindow && parsed.metricEvents?.length) {
    try {
      input.onMetricWindow({
        sourceId: input.rawRecord.sourceId,
        payloadBody,
        ...(input.rawRecord.payloadMetaJson === undefined ? {} : { payloadMetaJson: input.rawRecord.payloadMetaJson })
      })
    } catch (error) {
      console.log(JSON.stringify({
        marker: 'MI_METRIC_WINDOW_SINK_FAILED', sourceId: input.rawRecord.sourceId,
        message: String(error).slice(0, 200)
      }))
    }
  }
  return { state: 'parsed', parsed, payloadBody }
}
