import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { isAssistantImageMessagePart, type AssistantMessagePart } from '../schemas/messageSchemas'
import { createAssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import { generatedImageFileNamePattern } from '../../../ui/images/generatedImageUrl'
import { createGeneratedImageStorage, type GeneratedImageStorage } from '../../../storage/generatedImageStorage'
import { createAssistantImageMessageService } from './assistantImageMessageService'

/**
 * T2：图像生成 = 真消息。
 * - 生成前先落一条 pending 占位（status 'pending'）⇒ 生成中在消息数组里可见；
 * - 完成后**同一条**消息被替换为图片 part（不新增一条），失败则替换为错误 part；
 * - 消息与图片都落盘（sqlite + 文件），重开数据库后仍在；消息体里不出现 `data:`。
 */
const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const modelSnapshot = { id: 'acme-image', name: 'Acme Image', provider: 'Acme' }

describe('assistantImageMessageService', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function harness() {
    const root = mkdtempSync(join(tmpdir(), 'sample-product-image-messages-'))
    dirs.push(root)
    const databasePath = join(root, 'assistants.sqlite')
    const imagesDirectory = join(root, 'generated-images')
    const storage = createGeneratedImageStorage({ directory: imagesDirectory })
    const open = () => {
      const db = createAssistantPlatformDatabase(databasePath)
      const repositories = createAssistantPlatformRepositories(db)
      return { db, repositories, service: createAssistantImageMessageService({ repositories, storage }) }
    }
    const first = open()
    const assistant = first.repositories.assistants.create({ name: 'Images', prompt: 'Draw.' })
    const topic = first.repositories.topics.create({ assistantId: assistant.id, name: 'Topic' })
    return { root, imagesDirectory, storage, topicId: topic.id, ...first }
  }

  function imageParts(message: { data: { parts: AssistantMessagePart[] } }) {
    return message.data.parts.filter(isAssistantImageMessagePart)
  }

  it('creates a pending placeholder before the request and settles the same message with a file reference', async () => {
    const h = harness()
    const prepared = await h.service.prepare({
      topicId: h.topicId,
      operation: 'generate',
      modelId: modelSnapshot.id,
      modelSnapshot,
      prompt: 'a red fox'
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    // 生成中：消息数组里已经有这一条（status pending），并且没有图片 part
    const pending = h.repositories.messages.getById(prepared.assistantMessageId)
    expect(pending?.status).toBe('pending')
    expect(pending?.data.parts).toEqual([{ type: 'image-generation', status: 'generating', operation: 'generate' }])
    expect(imageParts(pending!).length).toBe(0)
    expect(h.repositories.messages.listByTopic(h.topicId).map((item) => item.id)).toEqual([
      prepared.assistantMessageId
    ])

    const settled = await h.service.settle({
      assistantMessageId: prepared.assistantMessageId,
      outcome: { ok: true, images: [{ mime: 'image/png', base64: onePixelPng }] }
    })
    expect(settled).toMatchObject({ ok: true, imageCount: 1 })

    // 同一条消息被替换：没有多出一条
    const messages = h.repositories.messages.listByTopic(h.topicId)
    expect(messages.map((item) => item.id)).toEqual([prepared.assistantMessageId])
    expect(messages[0]?.status).toBe('success')
    const parts = imageParts(messages[0]!)
    expect(parts).toHaveLength(1)
    const part = parts[0]!
    expect(part.mime).toBe('image/png')
    expect(part.byteLength).toBeGreaterThan(0)
    expect(part.width).toBe(1)
    expect(part.height).toBe(1)
    expect(part.fileName).toMatch(generatedImageFileNamePattern)
    // 文件真的在盘上，消息只存引用
    expect(readdirSync(h.imagesDirectory)).toEqual([part.fileName])
    expect(statSync(join(h.imagesDirectory, part.fileName)).size).toBe(part.byteLength)
    const serialized = JSON.stringify(messages[0]?.data)
    expect(serialized).not.toContain('data:')
    expect(serialized).not.toContain(onePixelPng)
    expect(serialized).not.toContain('base64')
    expect(messages[0]?.modelSnapshot).toEqual(modelSnapshot)
  })

  it('keeps the image message after reopening the database', async () => {
    const h = harness()
    const prepared = await h.service.prepare({
      topicId: h.topicId,
      operation: 'generate',
      modelId: modelSnapshot.id,
      modelSnapshot,
      prompt: 'a red fox'
    })
    if (!prepared.ok) throw new Error('expected a prepared message')
    await h.service.settle({
      assistantMessageId: prepared.assistantMessageId,
      outcome: { ok: true, images: [{ mime: 'image/png', base64: onePixelPng }] }
    })

    h.db.connection.close()
    const reopenedDb = createAssistantPlatformDatabase(join(h.root, 'assistants.sqlite'))
    const reopened = createAssistantPlatformRepositories(reopenedDb)
    const messages = reopened.messages.getBranchMessages(h.topicId).messages.map((entry) => entry.message)

    expect(messages).toHaveLength(1)
    const parts = imageParts(messages[0]!)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.fileName).toMatch(generatedImageFileNamePattern)
    expect(readdirSync(h.imagesDirectory)).toEqual([parts[0]!.fileName])
    reopenedDb.connection.close()
  })

  it('appends the image message after the existing branch and keeps order', async () => {
    const h = harness()
    h.repositories.messages.create(h.topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'earlier question' }] }
    })

    const prepared = await h.service.prepare({
      topicId: h.topicId,
      operation: 'generate',
      modelId: modelSnapshot.id,
      modelSnapshot,
      prompt: 'a red fox'
    })
    if (!prepared.ok) throw new Error('expected a prepared message')
    await h.service.settle({
      assistantMessageId: prepared.assistantMessageId,
      outcome: { ok: true, images: [{ mime: 'image/png', base64: onePixelPng }] }
    })

    const messages = h.repositories.messages.listByTopic(h.topicId)
    expect(messages.map((item) => item.role)).toEqual(['user', 'assistant'])
    expect(messages[1]?.id).toBe(prepared.assistantMessageId)
    expect(messages[1]?.parentId).toBe(messages[0]?.id)
  })

  it('replaces the placeholder with an error message on failure and renders no image', async () => {
    const h = harness()
    const prepared = await h.service.prepare({
      topicId: h.topicId,
      operation: 'generate',
      modelId: modelSnapshot.id,
      modelSnapshot,
      prompt: 'a red fox'
    })
    if (!prepared.ok) throw new Error('expected a prepared message')

    const settled = await h.service.settle({
      assistantMessageId: prepared.assistantMessageId,
      outcome: { ok: false, reasonCode: 'http_401', message: 'HTTP 401 · Unauthorized' }
    })

    expect(settled).toMatchObject({ ok: false, reasonCode: 'http_401', messageId: prepared.assistantMessageId })
    const messages = h.repositories.messages.listByTopic(h.topicId)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe(prepared.assistantMessageId)
    expect(messages[0]?.status).toBe('error')
    expect(imageParts(messages[0]!)).toHaveLength(0)
    expect(messages[0]?.data.parts).toEqual([
      { type: 'error', message: 'HTTP 401 · Unauthorized', reasonCode: 'http_401' }
    ])
    // 失败时连图片目录都不创建
    expect(existsSync(h.imagesDirectory)).toBe(false)
  })

  it('refuses to store an oversized result and marks the message failed', async () => {
    const h = harness()
    const prepared = await h.service.prepare({
      topicId: h.topicId,
      operation: 'generate',
      modelId: modelSnapshot.id,
      modelSnapshot,
      prompt: 'a red fox'
    })
    if (!prepared.ok) throw new Error('expected a prepared message')
    const huge = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64')

    const settled = await h.service.settle({
      assistantMessageId: prepared.assistantMessageId,
      outcome: { ok: true, images: [{ mime: 'image/png', base64: huge }] }
    })

    expect(settled).toMatchObject({ ok: false, reasonCode: 'image_too_large' })
    const messages = h.repositories.messages.listByTopic(h.topicId)
    expect(messages[0]?.status).toBe('error')
    expect(imageParts(messages[0]!)).toHaveLength(0)
    // 失败时连图片目录都不创建
    expect(existsSync(h.imagesDirectory)).toBe(false)
  })

  it('persists the edit as a user message with the source image plus the prompt, then the result message', async () => {
    const h = harness()
    const source = await storeSource(h.storage)

    const prepared = await h.service.prepare({
      topicId: h.topicId,
      operation: 'edit',
      modelId: modelSnapshot.id,
      modelSnapshot,
      prompt: 'make it blue',
      sourceImage: source
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.userMessageId).toBeTruthy()

    const pending = h.repositories.messages.listByTopic(h.topicId)
    expect(pending.map((item) => item.role)).toEqual(['user', 'assistant'])
    expect(pending[0]?.data.parts[0]).toMatchObject({
      type: 'image',
      kind: 'image',
      mime: source.mime,
      fileName: source.fileName,
      byteLength: source.byteLength
    })
    expect(pending[0]?.data.parts[1]).toEqual({ type: 'text', text: 'make it blue' })
    expect(pending[1]?.status).toBe('pending')
    expect(pending[1]?.data.parts).toEqual([{ type: 'image-generation', status: 'generating', operation: 'edit' }])

    await h.service.settle({
      assistantMessageId: prepared.assistantMessageId,
      outcome: { ok: true, images: [{ mime: 'image/png', base64: onePixelPng }] }
    })

    const settled = h.repositories.messages.listByTopic(h.topicId)
    expect(settled.map((item) => item.role)).toEqual(['user', 'assistant'])
    expect(imageParts(settled[1]!)).toHaveLength(1)
    expect(settled[1]?.parentId).toBe(settled[0]?.id)
  })
})

async function storeSource(storage: GeneratedImageStorage) {
  const outcome = await storage.write(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    ),
    'image/png'
  )
  if (!outcome.ok) throw new Error('expected a stored source image')
  return outcome.file
}
