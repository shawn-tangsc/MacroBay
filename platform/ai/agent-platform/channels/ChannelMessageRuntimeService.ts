import type { AgentPlatformServices } from '../services'
import type { AgentChannelIncomingAttachment, AgentChannelIncomingTextEvent } from './channelRuntimeHost'
import {
  parseChannelSlashCommand,
  type ChannelCommandDispatchResult,
  type ChannelCommandRequest
} from './channelSlashCommands'
import {
  guardExternalContent,
  type ExternalContentMetadata
} from './ExternalContentGuard'
import {
  sanitizeChannelOutput,
  type SanitizedChannelOutput
} from './OutputSanitizer'

export type ChannelSessionResolution = {
  sessionId: string
  created: boolean
  source: 'tracker' | 'channel' | 'created-or-bound-channel'
}

export type ChannelIncomingText = AgentChannelIncomingTextEvent

export type ChannelFlushedBatchSecurity = ExternalContentMetadata & {
  cleanedText: string
  suspiciousPatternNames: string[]
}

export type ChannelIncomingAttachment = AgentChannelIncomingAttachment

export type PersistedChannelAttachment = {
  kind: 'image' | 'file'
  originalName: string
  savedPath: string
}

export type ChannelFlushedBatch = {
  agentId: string
  channelId: string
  chatId: string
  sessionId: string
  text: string
  rawText: string
  messageCount: number
  startedAt: number
  flushedAt: number
  security: ChannelFlushedBatchSecurity
  sanitizeOutput: (text: string) => SanitizedChannelOutput
}

type ChannelMessageRuntimeServiceDependencies = {
  services: AgentPlatformServices
  now?: () => number
  batchWindowMs?: number
  dispatchCommand?: (request: ChannelCommandRequest) => Promise<ChannelCommandDispatchResult>
  persistChannelAttachments?: (input: {
    sessionId: string
    workspacePath: string
    attachments: ChannelIncomingAttachment[]
  }) => Promise<{
    savedFiles: PersistedChannelAttachment[]
  }>
  flushMessageBatch?: (batch: ChannelFlushedBatch) => Promise<void>
}

type PendingResolution = Promise<ChannelSessionResolution>

type PendingBatch = {
  agentId: string
  channelId: string
  chatId: string
  channelType: string
  userId: string
  userName: string
  trackerKey: string
  sessionId: string
  texts: string[]
  attachments: ChannelIncomingAttachment[]
  startedAt: number
  timer: ReturnType<typeof setTimeout>
  deferred: DeferredPromise<void>
}

const DEFAULT_BATCH_WINDOW_MS = 8_000
const defaultNow = (): number => Date.now()

export class ChannelMessageRuntimeService {
  private readonly sessionTracker = new Map<string, string>()
  private readonly pendingResolutions = new Map<string, PendingResolution>()
  private readonly pendingBatches = new Map<string, PendingBatch>()
  private readonly chatQueues = new Map<string, Promise<void>>()
  private readonly ingestQueues = new Map<string, Promise<void>>()

  constructor(private readonly deps: ChannelMessageRuntimeServiceDependencies) {}

  async resolveSession(input: {
    agentId: string
    channelId: string
    chatId: string
  }): Promise<ChannelSessionResolution> {
    const trackerKey = buildTrackerKey(input.agentId, input.channelId, input.chatId)
    const trackedSessionId = this.sessionTracker.get(trackerKey)
    if (trackedSessionId) {
      return {
        sessionId: trackedSessionId,
        created: false,
        source: 'tracker'
      }
    }

    const pending = this.pendingResolutions.get(trackerKey)
    if (pending) {
      return pending
    }

    const promise = this.resolveAndTrackSession(trackerKey, input)
    this.pendingResolutions.set(trackerKey, promise)
    try {
      return await promise
    } finally {
      this.pendingResolutions.delete(trackerKey)
    }
  }

  async enqueueIncomingText(input: ChannelIncomingText): Promise<void> {
    const trackerKey = buildTrackerKey(input.agentId, input.channelId, input.chatId)
    const command = parseChannelSlashCommand(input.text)

    if (command && this.deps.dispatchCommand) {
      await (this.ingestQueues.get(trackerKey) ?? Promise.resolve())
      await this.flushPendingBatchNow(trackerKey)
      await this.enqueueChatWork(trackerKey, async () => {
        await this.dispatchRecognizedCommand(input, command)
      })
      return
    }

    let flushCompletion: Promise<void> | undefined

    await this.enqueueIngestWork(trackerKey, async () => {
      const registration = await this.registerIncomingText(input, trackerKey)
      flushCompletion = registration.flush
    })

    if (flushCompletion) {
      await flushCompletion
    }
  }

  private async registerIncomingText(
    input: ChannelIncomingText,
    trackerKey: string
  ): Promise<{ flush?: Promise<void> }> {
    const resolution = await this.resolveSession(input)
    const existing = this.pendingBatches.get(trackerKey)
    if (existing) {
      existing.texts.push(input.text)
      if (input.attachments?.length) {
        existing.attachments.push(...input.attachments)
      }
      return { flush: existing.deferred.promise }
    }

    const deferred = createDeferredPromise<void>()
    const batchWindowMs = this.deps.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS
    const batch: PendingBatch = {
      agentId: input.agentId,
      channelId: input.channelId,
      chatId: input.chatId,
      channelType: input.channelType ?? 'external-channel',
      userId: input.userId ?? input.chatId,
      userName: input.userName ?? 'External User',
      trackerKey,
      sessionId: resolution.sessionId,
      texts: [input.text],
      attachments: [...(input.attachments ?? [])],
      startedAt: (this.deps.now ?? defaultNow)(),
      timer: setTimeout(() => {
        void this.flushBatch(trackerKey).catch(() => undefined)
      }, batchWindowMs),
      deferred
    }

    this.pendingBatches.set(trackerKey, batch)
    return { flush: batch.deferred.promise }
  }

  private async dispatchRecognizedCommand(
    input: ChannelIncomingText,
    command: NonNullable<ReturnType<typeof parseChannelSlashCommand>>
  ): Promise<void> {
    const trackerKey = buildTrackerKey(input.agentId, input.channelId, input.chatId)
    const resolution = command === 'compact' ? await this.resolveSession(input) : null
    const result = await this.deps.dispatchCommand?.({
      agentId: input.agentId,
      channelId: input.channelId,
      chatId: input.chatId,
      channelType: input.channelType,
      userId: input.userId,
      userName: input.userName,
      rawText: input.text,
      command,
      sessionId: resolution?.sessionId
    })
    const trackedSessionId = result?.trackedSessionId?.trim()
    if (trackedSessionId) {
      this.sessionTracker.set(trackerKey, trackedSessionId)
    }
  }

  private async resolveAndTrackSession(
    trackerKey: string,
    input: { agentId: string; channelId: string; chatId: string }
  ): Promise<ChannelSessionResolution> {
    const channel = await this.deps.services.channels.getRequired(input.channelId)
    const boundSessionId = channel.sessionId
    if (boundSessionId && (await this.deps.services.sessions.exists(boundSessionId))) {
      this.sessionTracker.set(trackerKey, boundSessionId)
      return {
        sessionId: boundSessionId,
        created: false,
        source: 'channel'
      }
    }

    const existing = await this.findLatestSessionForChannelAgent(input.agentId)
    if (existing) {
      if (channel.sessionId !== existing.id) {
        await this.deps.services.channels.update(input.channelId, {
          sessionId: existing.id
        })
      }
      this.sessionTracker.set(trackerKey, existing.id)
      return {
        sessionId: existing.id,
        created: false,
        source: 'created-or-bound-channel'
      }
    }

    const session = await this.deps.services.sessions.create({
      agentId: input.agentId,
      name: `${channel.name} Chat`,
      workspace: channel.workspace
    })
    await this.deps.services.channels.update(input.channelId, {
      sessionId: session.id
    })
    this.sessionTracker.set(trackerKey, session.id)
    return {
      sessionId: session.id,
      created: true,
      source: 'created-or-bound-channel'
    }
  }

  private async findLatestSessionForChannelAgent(agentId: string) {
    const page = await this.deps.services.sessions.listByCursor({
      agentId,
      limit: 1
    })
    return page.items[0] ?? null
  }

  private async flushBatch(trackerKey: string): Promise<void> {
    const batch = this.pendingBatches.get(trackerKey)
    if (!batch) return
    this.pendingBatches.delete(trackerKey)
    clearTimeout(batch.timer)

    await this.enqueueChatWork(batch.trackerKey, () => this.executeBatchFlush(batch))
  }

  private async flushPendingBatchNow(trackerKey: string): Promise<void> {
    const batch = this.pendingBatches.get(trackerKey)
    if (!batch) return
    this.pendingBatches.delete(trackerKey)
    clearTimeout(batch.timer)
    await this.executeBatchFlush(batch)
  }

  private async executeBatchFlush(batch: PendingBatch): Promise<void> {
    try {
      const rawText = batch.texts.join('\n')
      const textWithAttachmentPaths = await this.appendPersistedAttachmentPaths(batch, rawText)
      const guardedContent = guardExternalContent(textWithAttachmentPaths, {
        chatId: batch.chatId,
        userId: batch.userId,
        userName: batch.userName,
        channelType: batch.channelType
      })
      await this.deps.flushMessageBatch?.({
        agentId: batch.agentId,
        channelId: batch.channelId,
        chatId: batch.chatId,
        sessionId: batch.sessionId,
        text: guardedContent.wrappedText,
        rawText,
        messageCount: batch.texts.length,
        startedAt: batch.startedAt,
        flushedAt: (this.deps.now ?? defaultNow)(),
        security: {
          ...guardedContent.metadata,
          cleanedText: guardedContent.cleanedText,
          suspiciousPatternNames: guardedContent.suspiciousPatternNames
        },
        sanitizeOutput: sanitizeChannelOutput
      })
      batch.deferred.resolve()
    } catch (error) {
      batch.deferred.reject(error)
      throw error
    }
  }

  private enqueueIngestWork<T>(trackerKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.ingestQueues.get(trackerKey) ?? Promise.resolve()
    const current = previous.then(work)
    const settled: Promise<void> = current.then(
      () => undefined,
      () => undefined
    )
    const tail = settled.finally(() => {
      if (this.ingestQueues.get(trackerKey) === tail) {
        this.ingestQueues.delete(trackerKey)
      }
    })
    this.ingestQueues.set(trackerKey, tail)
    return current
  }

  private enqueueChatWork<T>(trackerKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chatQueues.get(trackerKey) ?? Promise.resolve()
    const current = previous.then(work)
    const settled: Promise<void> = current.then(
      () => undefined,
      () => undefined
    )
    const tail = settled.finally(() => {
      if (this.chatQueues.get(trackerKey) === tail) {
        this.chatQueues.delete(trackerKey)
      }
    })
    this.chatQueues.set(trackerKey, tail)
    return current
  }

  private async appendPersistedAttachmentPaths(batch: PendingBatch, text: string): Promise<string> {
    const attachments = batch.attachments
    if (attachments.length === 0 || !this.deps.persistChannelAttachments) {
      return text
    }

    const session = await this.deps.services.sessions.get(batch.sessionId)
    const workspacePath = session?.workspace?.path?.trim()
    if (!workspacePath) {
      return text
    }

    const persisted = await this.deps.persistChannelAttachments({
      sessionId: batch.sessionId,
      workspacePath,
      attachments
    })
    const savedPaths = persisted.savedFiles.map((file) => file.savedPath.trim()).filter(Boolean)
    if (savedPaths.length === 0) {
      return text
    }

    const attachmentBlock = ['Attached files:', ...savedPaths.map((savedPath) => `- ${savedPath}`)].join('\n')
    return text.trim() ? `${text}\n\n${attachmentBlock}` : attachmentBlock
  }
}

type DeferredPromise<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: DeferredPromise<T>['resolve']
  let reject!: DeferredPromise<T>['reject']
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return {
    promise,
    resolve,
    reject
  }
}

function buildTrackerKey(agentId: string, channelId: string, chatId: string): string {
  return `${agentId}:${channelId}:${chatId}`
}
