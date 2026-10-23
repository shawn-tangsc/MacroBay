import type { AssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import type {
  AssistantImageMessagePart,
  AssistantMessageData,
  AssistantModelSnapshot
} from '../schemas/messageSchemas'
import type {
  GeneratedImageStorage,
  StoredGeneratedImage
} from '../../../storage/generatedImageStorage'

/**
 * T2：把「一次图像生成/编辑」写成真消息。
 *
 * 顺序契约（渲染层只 refresh，不再自己拼卡片）：
 * 1. `prepare()` 先落消息：generate ⇒ 一条 pending 助手消息；edit ⇒ 用户消息
 *    `[image 原图, text prompt]` + 其后一条 pending 助手消息；
 * 2. `settle()` 用**同一个 message id** 把 pending 消息替换成图片 part（成功）或错误 part（失败），
 *    因此消息数组里不会多出一条；
 * 3. 图片字节落 `GeneratedImageStorage`，消息里只有 `{kind,mime,fileName,byteLength,width?,height?}`。
 *
 * 删会话/删消息都不删磁盘文件（保留），孤儿文件由一个尚未做的维护入口清理：
 * TODO(T2-followup)：在设置页加「清理未引用图片」= 遍历 generated-images 与所有
 * `part.type === 'image'` 的 fileName 求差集后删除；本任务只保证不误删。
 */
export type ImageMessageOperation = 'generate' | 'edit'

export type PreparedImageMessage =
  | { ok: true; assistantMessageId: string; userMessageId: string | null }
  | { ok: false; reasonCode: string; message: string }

export type ImageMessageOutcome =
  | { ok: true; images: Array<{ mime: string; base64: string }> }
  | { ok: false; reasonCode: string; message: string }

export type SettledImageMessage =
  | { ok: true; messageId: string; imageCount: number }
  | { ok: false; reasonCode: string; message: string; messageId: string }

export type AssistantImageMessageService = {
  prepare: (input: {
    topicId: string
    operation: ImageMessageOperation
    modelId: string
    modelSnapshot: AssistantModelSnapshot | null
    prompt: string
    sourceImage?: StoredGeneratedImage | null
  }) => Promise<PreparedImageMessage>
  settle: (input: {
    assistantMessageId: string
    outcome: ImageMessageOutcome
  }) => Promise<SettledImageMessage>
}

export function createAssistantImageMessageService(input: {
  repositories: Pick<AssistantPlatformRepositories, 'messages' | 'topics'>
  storage: GeneratedImageStorage
}): AssistantImageMessageService {
  const { repositories, storage } = input

  return {
    async prepare(request) {
      if (!repositories.topics.getById(request.topicId)) {
        return { ok: false, reasonCode: 'invalid_request', message: 'The topic was not found.' }
      }
      let userMessageId: string | null = null
      if (request.operation === 'edit') {
        if (!request.sourceImage) {
          return { ok: false, reasonCode: 'invalid_request', message: 'A source image is required.' }
        }
        const userMessage = repositories.messages.create(request.topicId, {
          role: 'user',
          status: 'success',
          data: {
            parts: [toImagePart(request.sourceImage), { type: 'text', text: request.prompt }]
          }
        })
        userMessageId = userMessage.id
      }
      const assistantMessage = repositories.messages.create(request.topicId, {
        role: 'assistant',
        status: 'pending',
        // 占位 part 让「生成中」在刷新/重开后仍然是人话（完成后同一条消息被图片 part 替换）。
        data: { parts: [{ type: 'image-generation', status: 'generating', operation: request.operation }] },
        modelId: request.modelId,
        modelSnapshot: request.modelSnapshot
      })
      return { ok: true, assistantMessageId: assistantMessage.id, userMessageId }
    },

    async settle(request) {
      const message = repositories.messages.getById(request.assistantMessageId)
      if (!message) {
        return {
          ok: false,
          reasonCode: 'invalid_request',
          message: 'The image message was not found.',
          messageId: request.assistantMessageId
        }
      }
      if (request.outcome.ok === false) {
        return failWith(request.assistantMessageId, request.outcome.reasonCode, request.outcome.message)
      }

      const parts: AssistantImageMessagePart[] = []
      for (const image of request.outcome.images) {
        const bytes = Buffer.from(image.base64, 'base64')
        const stored = await storage.write(bytes, image.mime)
        if (!stored.ok) {
          return failWith(request.assistantMessageId, stored.reasonCode, stored.message)
        }
        parts.push(toImagePart(stored.file))
      }
      if (parts.length === 0) {
        return failWith(
          request.assistantMessageId,
          'invalid_response',
          'The image service returned no image.'
        )
      }
      repositories.messages.update(request.assistantMessageId, {
        data: { parts },
        status: 'success'
      })
      return { ok: true, messageId: request.assistantMessageId, imageCount: parts.length }
    }
  }

  function failWith(messageId: string, reasonCode: string, message: string): SettledImageMessage {
    const data: AssistantMessageData = {
      parts: [{ type: 'error', message, reasonCode }]
    }
    repositories.messages.update(messageId, { data, status: 'error' })
    return { ok: false, reasonCode, message, messageId }
  }
}

function toImagePart(image: Omit<AssistantImageMessagePart, 'type' | 'kind'>): AssistantImageMessagePart {
  return {
    type: 'image',
    kind: 'image',
    mime: image.mime,
    fileName: image.fileName,
    byteLength: image.byteLength,
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height })
  }
}
