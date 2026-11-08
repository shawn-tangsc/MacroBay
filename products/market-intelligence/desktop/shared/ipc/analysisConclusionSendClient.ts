import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'

/**
 * 抽屉里「发送到频道」的渲染层入口：**只传运行 id**。
 *
 * 结论句、去重键、通道都由主进程按 id 现取——渲染层传不了内容，也就不会出现
 * 「屏幕上这条」与「实际发出去那条」不是同一条的情况。
 *
 * 回执原样交回：`accepted` 只说明**提交成功**，不等于手机收到了（免打扰会把 `delivery.push`
 * 摘掉、通道不可用会让它带 reason），所以这里不替页面把两件事合成一个布尔。
 */
export type AnalysisConclusionSendReceipt =
  | Readonly<{ kind: 'accepted'; recordId: string; levels: readonly string[] }>
  | Readonly<{ kind: 'rejected'; reason: string }>

const PRODUCT_ID = 'market-intelligence'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 回执解析：认不出形状就抛——**不猜成成功**，也不猜成某一种失败。 */
export function readSendReceipt(value: unknown): AnalysisConclusionSendReceipt {
  if (!isRecord(value)) throw new Error('analysis-conclusion-send-unreadable')
  if (value.kind === 'accepted' && typeof value.recordId === 'string' && value.recordId.length > 0) {
    const levels = Array.isArray(value.levels) ? value.levels.filter((level): level is string => typeof level === 'string') : []
    return { kind: 'accepted', recordId: value.recordId, levels }
  }
  if (value.kind === 'rejected' && typeof value.reason === 'string' && value.reason.length > 0) {
    return { kind: 'rejected', reason: value.reason }
  }
  throw new Error('analysis-conclusion-send-unreadable')
}

export async function sendAnalysisConclusion(analysisRunId: string): Promise<AnalysisConclusionSendReceipt> {
  return readSendReceipt(await window.platform.products.invoke(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.sendAnalysisConclusion, { analysisRunId }))
}
