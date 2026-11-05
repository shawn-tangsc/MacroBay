import { createHash } from 'node:crypto'

import { getAgentTextParts } from '../../schemas/messageDataHelpers'
import type { TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { AgentChatRuntimeResult } from '../agentChatRuntime'

/**
 * 把一次运行的结果压成运行记录要的那几格：全文、预览、哈希、字符数与用量。
 *
 * 从 `AgentTaskDispatchService` 抽出来的原因：它是纯整形，不读服务状态、不碰存储；留在派发服务里
 * 会把那个文件顶过体积基线，也让「预览截断」与「用量归一」这两条规则和派发流程混在一起。
 * **没有行为变化**：同样的 200 字截断、同样的哈希输入与同样的 token 兜底。
 */
const taskResultPreviewMaxChars = 200

export function summarizeTaskResult(result: AgentChatRuntimeResult): {
  fullText: string
  preview: string
  hash: string
  charCount: number
  usage: TaskRunLogEntity['usage']
} {
  const assistantText = getAgentTextParts(result.assistantMessage.data).join('\n').trim()
  const fullText = assistantText || 'Completed.'
  const usage = normalizeTaskRunUsage(result.assistantMessage.stats)
  const preview = fullText.length <= taskResultPreviewMaxChars
    ? fullText
    : `${fullText.slice(0, taskResultPreviewMaxChars - 3)}...`
  return {
    fullText,
    preview,
    hash: createHash('sha256').update(fullText).digest('hex'),
    charCount: fullText.length,
    usage
  }
}

function normalizeTaskRunUsage(stats: AgentChatRuntimeResult['assistantMessage']['stats']): TaskRunLogEntity['usage'] {
  if (!stats) return null
  const inputTokens = safeTokenCount(stats.promptTokens)
  const outputTokens = safeTokenCount(stats.completionTokens)
  const totalTokens = safeTokenCount(stats.totalTokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return null
  return { inputTokens, outputTokens, totalTokens }
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
