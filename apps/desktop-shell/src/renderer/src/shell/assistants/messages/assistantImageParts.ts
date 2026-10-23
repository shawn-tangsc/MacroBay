import {
  isAssistantImageMessagePart,
  type AssistantImageMessagePart
} from '@platform/ai/assistant-platform/schemas/messageSchemas'

import type { AssistantBranchEntry } from '../assistantMessageRendering'

/**
 * T3：把当前分支消息里的图片 part 汇总成「可编辑的原图」候选。
 * 同一文件只出现一次（同一张图被生成/编辑多次时按首次出现排序），顺序即会话顺序倒序使用方自行决定。
 */
export function collectAssistantImageParts(
  entries: readonly AssistantBranchEntry[]
): AssistantImageMessagePart[] {
  const seen = new Set<string>()
  const images: AssistantImageMessagePart[] = []
  for (const entry of entries) {
    for (const part of entry.message.data.parts) {
      if (!isAssistantImageMessagePart(part)) continue
      if (seen.has(part.fileName)) continue
      seen.add(part.fileName)
      images.push(part)
    }
  }
  return images
}
