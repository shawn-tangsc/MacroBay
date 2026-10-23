import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppLanguage, ChatSettings } from '@platform/settings/schema/appSettings'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { ProviderRuntimeFailurePolicy } from '@platform/ai/providers/modelProviderTypes'
import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { AssistantTopicEntity } from '@platform/ai/assistant-platform/schemas/topicSchemas'
import type { AssistantMessageEntity } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import {
  type AssistantStreamOpenResponse,
  type AssistantTopicStreamSnapshot
} from '@platform/ai/assistant-platform/schemas/streamSchemas'
import { createDefaultAssistantSeed } from '@platform/ai/assistant-platform/seeds/defaultAssistantSeed'
import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'

import { AssistantHeader } from './AssistantHeader'
import { AssistantSidePanel } from './AssistantSidePanel'
import { AssistantChatPane } from './AssistantChatPane'
import { AssistantSettingsDrawer } from './AssistantSettingsDrawer'
import { platformText, type PlatformText } from '../../i18n/platformText'
import type { AssistantBranchEntry } from './assistantMessageRendering'
import type { AssistantInputbarToolId } from './inputbar/assistantInputbarRegistry'
import { useAssistantMentionModels } from './useAssistantMentionModels'
import {
  abandonSend,
  acceptsStatusTerminal,
  beginSend,
  idleAssistantSendFence,
  recordSendExecutions,
  settleSend,
  type AssistantSendFence
} from './assistantSendFence'
import { ModelPicker } from '../components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate } from '../components/ModelPicker/modelPickerOptions'
import { selectTopicAfterDeletion } from './assistantTopicSelection'
import { useAssistantImageGeneration } from './imageGeneration/useAssistantImageGeneration'
import { collectAssistantImageParts } from './messages/assistantImageParts'

/**
 * 助手页顶部选择器的约束（唯一事实）：文本类入口只列 chat 模型，协议不限。
 * 差异全部声明在 `ModelPickerConstraints` 上，组件内部不为页面写 if。
 */
const MODEL_PICKER_ASSISTANT_CONSTRAINTS = { requireCapabilities: ['chat'] } as const

type AssistantPageProps = {
  language: AppLanguage
  providers: SafeModelProvider[]
  chatSettings: ChatSettings
  pinnedModelIds: readonly string[]
  /** 模型服务页「默认助手模型」：助手没绑定模型时用它，选择器回显「跟随默认」。 */
  defaultAssistantModelId?: string
  openRequest?: AssistantOpenRequest | null
}

export type AssistantOpenRequest = {
  assistantId: string
  topicId: string
}

type AssistantSidePanelTab = 'assistants' | 'topics'

function parseAssistantModelId(value: string | null | undefined): { providerId: string; modelId: string } | null {
  if (!value) return null
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1)
  }
}

function hasReadyChatModel(provider: SafeModelProvider): boolean {
  return provider.enabled && provider.hasApiKey && provider.models.some((model) => model.capabilities.chat)
}

function isAssistantChatReady(
  assistant: AssistantEntity | null,
  providers: readonly SafeModelProvider[]
): boolean {
  if (!assistant) return false
  const modelReference = parseAssistantModelId(assistant.modelId)
  if (!modelReference) {
    return providers.some(hasReadyChatModel)
  }

  const provider = providers.find((entry) => entry.id === modelReference.providerId)
  if (!provider || !provider.enabled || !provider.hasApiKey) return false
  return provider.models.some((model) => model.id === modelReference.modelId && model.capabilities.chat)
}

function normalizeAssistantStatusMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

type AssistantStreamErrorTextLabels = Pick<
  PlatformText['assistants'],
  'modelNotReady' | 'conversationOperationFailed' | 'modelRetired' | 'modelNotActivated' | 'modelNotFound'
>

/** Renderer-safe stream errors are stable runtime codes, never upstream messages. */
export function resolveAssistantStreamErrorText(error: unknown, labels: AssistantStreamErrorTextLabels): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (code === ProviderRuntimeFailurePolicy.configurationRequired) return labels.modelNotReady
  // PLAT-74：模型生命周期失败给真实结论，不再只说「请重试」。
  if (code === ProviderRuntimeFailurePolicy.modelRetired) return labels.modelRetired
  if (code === ProviderRuntimeFailurePolicy.modelNotActivated) return labels.modelNotActivated
  if (code === ProviderRuntimeFailurePolicy.modelNotFound) return labels.modelNotFound
  return labels.conversationOperationFailed
}

const AssistantComposerTerminalStreamStatuses = new Set<AssistantTopicStreamSnapshot['status']>([
  'done',
  'aborted',
  'error'
])

function isTerminalAssistantComposerSnapshot(snapshot: AssistantTopicStreamSnapshot): boolean {
  return AssistantComposerTerminalStreamStatuses.has(snapshot.status)
}

export function AssistantPage({
  language,
  providers,
  chatSettings,
  pinnedModelIds,
  defaultAssistantModelId,
  openRequest
}: AssistantPageProps): React.ReactElement {
  const t = platformText[language].assistants
  const [assistants, setAssistants] = useState<AssistantEntity[]>([])
  const [topics, setTopics] = useState<AssistantTopicEntity[]>([])
  const [activeTab, setActiveTab] = useState<AssistantSidePanelTab>('assistants')
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantBranchEntry[]>([])
  const [searchHits, setSearchHits] = useState<AssistantMessageEntity[]>([])
  const [streamSnapshot, setStreamSnapshot] = useState<AssistantTopicStreamSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const deletingTopicIds = useRef(new Set<string>())
  const activeTopicIdRef = useRef<string | null>(null)
  /** 发送归属状态机（纯函数，见 `assistantSendFence.ts`）：只让属于本次执行的事件解锁输入框。 */
  const sendFenceRef = useRef<AssistantSendFence>(idleAssistantSendFence)

  useEffect(() => {
    activeTopicIdRef.current = activeTopicId
  }, [activeTopicId])

  const setCurrentTopicId = useCallback((topicId: string | null) => {
    activeTopicIdRef.current = topicId
    setActiveTopicId(topicId)
  }, [])

  const beginSendingTopic = useCallback((topicId: string, acceptsEarlyTerminalEvents: boolean) => {
    sendFenceRef.current = beginSend(topicId, acceptsEarlyTerminalEvents)
    setIsSending(true)
  }, [])

  const recordSendingExecutions = useCallback((topicId: string, response: AssistantStreamOpenResponse) => {
    const outcome = recordSendExecutions(sendFenceRef.current, topicId, response.executionIds ?? [])
    sendFenceRef.current = outcome.fence
    if (outcome.settled) setIsSending(false)
  }, [])

  const finishSendingTopic = useCallback((topicId: string, executionId?: string) => {
    if (activeTopicIdRef.current !== topicId) return
    const outcome = settleSend(sendFenceRef.current, topicId, executionId)
    sendFenceRef.current = outcome.fence
    if (outcome.settled) setIsSending(false)
  }, [])

  const clearSendingTopic = useCallback((topicId?: string) => {
    const next = abandonSend(sendFenceRef.current, topicId)
    if (next === sendFenceRef.current) return
    sendFenceRef.current = next
    setIsSending(false)
  }, [])

  const activeAssistant = useMemo(
    () => assistants.find((item) => item.id === activeAssistantId) ?? null,
    [activeAssistantId, assistants]
  )
  const activeTopic = useMemo(
    () => topics.find((item) => item.id === activeTopicId) ?? null,
    [activeTopicId, topics]
  )
  const modelReady = useMemo(
    () => isAssistantChatReady(activeAssistant, providers),
    [activeAssistant, providers]
  )
  // 默认助手模型：只在助手没绑定模型时生效（与主进程 `resolveMentionedModelIds` 同一判据）。
  const defaultModelLabel = useMemo(() => {
    const resolved = resolveConfiguredModel({
      value: defaultAssistantModelId,
      providers,
      isModelAcceptable: (_provider, model) => model.capabilities.chat === true
    })
    return resolved.ok ? `${resolved.providerName} / ${resolved.modelName}` : null
  }, [defaultAssistantModelId, providers])
  const mentionModels = useAssistantMentionModels({ providers, pinnedModelIds })
  // 助手页模型候选：已启用且有 Key 的供应商；能力/协议约束交给选择器数据层（`MODEL_PICKER_ASSISTANT_CONSTRAINTS`）。
  const modelCandidates = useMemo<ModelPickerCandidate[]>(
    () =>
      providers
        .filter((provider) => provider.enabled && provider.hasApiKey)
        .flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, model }))),
    [providers]
  )
  const composerEnabled = Boolean(activeAssistant && modelReady)

  const refreshAssistants = useCallback(async () => {
    const next = (await window.platform.assistants.list()) as AssistantEntity[]
    setAssistants(next)
    setActiveAssistantId((current) =>
      current && next.some((assistant) => assistant.id === current) ? current : next[0]?.id ?? null
    )
  }, [])

  const refreshTopics = useCallback(async (assistantId: string) => {
    const result = (await window.platform.assistants.listTopics({ assistantId })) as {
      topics: AssistantTopicEntity[]
    }
    setTopics(result.topics)
    setActiveTopicId((current) => {
      const next = current && result.topics.some((item) => item.id === current) ? current : result.topics[0]?.id ?? null
      activeTopicIdRef.current = next
      return next
    })
  }, [])

  const refreshMessages = useCallback(async (topicId: string, nodeId?: string | null) => {
    const result = (await window.platform.assistants.listTopicMessages(topicId, nodeId)) as {
      messages: AssistantBranchEntry[]
    }
    setMessages(result.messages)
  }, [])

  useEffect(() => {
    void refreshAssistants()
  }, [language, refreshAssistants])

  useEffect(() => {
    if (!openRequest) return
    setStatusMessage(null)
    setActiveAssistantId(openRequest.assistantId)
    setCurrentTopicId(openRequest.topicId)
    setActiveTab('topics')
    setShowSidebar(true)
    setMessages([])
    setSearchHits([])
    setStreamSnapshot(null)
  }, [openRequest, setCurrentTopicId])

  useEffect(() => {
    if (!activeAssistantId) return
    void refreshTopics(activeAssistantId)
  }, [activeAssistantId, refreshTopics])

  useEffect(() => {
    if (!activeTopicId) {
      setMessages([])
      setSearchHits([])
      setStreamSnapshot(null)
      return
    }
    let cancelled = false
    void refreshMessages(activeTopicId)
    void window.platform.assistants.streamAttach(activeTopicId).then((attached) => {
      if (cancelled) return
      const snapshot = (attached as { snapshot: AssistantTopicStreamSnapshot }).snapshot
      if (snapshot.topicId !== activeTopicId) return
      setStreamSnapshot(snapshot)
    })
    return () => {
      cancelled = true
    }
  }, [activeTopicId, refreshMessages])

  useEffect(() => {
    setSearchHits([])
  }, [activeTopicId])

  useEffect(() => {
    const detachChunk = window.platform.assistants.onStreamChunk((payload) => {
      const topicId = (payload as { topicId?: string }).topicId
      if (!topicId || topicId !== activeTopicIdRef.current) return
      void refreshMessages(topicId)
    })
    const detachDone = window.platform.assistants.onStreamDone((payload) => {
      const streamDone = payload as { topicId?: string; executionId?: string; isTopicDone?: boolean }
      const topicId = streamDone.topicId
      if (topicId && topicId !== activeTopicIdRef.current) return
      if (!topicId) return
      setStatusMessage(null)
      void refreshMessages(topicId)
      if (activeAssistantId) void refreshTopics(activeAssistantId)
      if (streamDone.isTopicDone !== false) finishSendingTopic(topicId, streamDone.executionId)
    })
    const detachError = window.platform.assistants.onStreamError((payload) => {
      const streamError = payload as { topicId?: string; executionId?: string; isTopicDone?: boolean; error?: unknown }
      const topicId = streamError.topicId
      if (topicId && topicId !== activeTopicIdRef.current) return
      if (!topicId) return
      setStatusMessage(resolveAssistantStreamErrorText(streamError.error, t))
      void refreshMessages(topicId)
      if (streamError.isTopicDone !== false) finishSendingTopic(topicId, streamError.executionId)
    })
    const detachStatus = window.platform.assistants.onStreamStatusChanged((rawSnapshot) => {
      const snapshot = rawSnapshot as AssistantTopicStreamSnapshot
      if (snapshot.topicId !== activeTopicIdRef.current) return
      setStreamSnapshot(snapshot)
      if (!isTerminalAssistantComposerSnapshot(snapshot)) return
      // 既有话题：执行 id 还没回来时，这条终态可能属于上一次执行，不能据此解锁（PLAT-64 回归）。
      if (!acceptsStatusTerminal(sendFenceRef.current, snapshot.topicId)) return
      finishSendingTopic(snapshot.topicId)
    })
    return () => {
      detachChunk()
      detachDone()
      detachError()
      detachStatus()
    }
  }, [activeAssistantId, finishSendingTopic, refreshMessages, refreshTopics, t])

  async function createTopicForAssistant(
    assistantId: string,
    options?: { activateTab?: boolean }
  ): Promise<AssistantTopicEntity> {
    const topic = (await window.platform.assistants.createTopic({
      assistantId,
      name: t.newTopic
    })) as AssistantTopicEntity
    await refreshTopics(assistantId)
    setCurrentTopicId(topic.id)
    if (options?.activateTab ?? true) {
      setActiveTab('topics')
    }
    return topic
  }

  async function handleCreateAssistant(): Promise<void> {
    const seed = createDefaultAssistantSeed({ language })
    const created = (await window.platform.assistants.create({
      name: t.newAssistantName(assistants.length + 1),
      prompt: seed.prompt,
      icon: seed.icon,
      description: seed.description,
      settings: seed.settings,
      modelId: defaultAssistantModelId ?? null
    })) as AssistantEntity
    setStatusMessage(null)
    await refreshAssistants()
    setActiveAssistantId(created.id)
    setCurrentTopicId(null)
    setActiveTab('assistants')
    setShowSidebar(true)
  }

  async function handleCreateTopic(): Promise<void> {
    if (!activeAssistantId) return
    setStatusMessage(null)
    await createTopicForAssistant(activeAssistantId)
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || !activeAssistantId || isSending) return
    setStatusMessage(null)
    setIsSending(true)
    setDraft('')
    try {
      const hasExistingTopic = activeTopicId !== null
      const topicId = activeTopicId ?? (await createTopicForAssistant(activeAssistantId)).id
      beginSendingTopic(topicId, !hasExistingTopic)
      const response = (await window.platform.assistants.streamOpen({
        topicId,
        assistantId: activeAssistantId,
        trigger: 'submit-message',
        userMessageParts: [{ type: 'text', text }],
        ...(mentionModels.mentionedModelIds.length > 0
          ? { mentionedModelIds: mentionModels.mentionedModelIds }
          : {})
      })) as AssistantStreamOpenResponse
      if (response.mode !== 'started' && response.mode !== 'injected') {
        setDraft(text)
        setStatusMessage(response.message ?? t.modelNotReady)
        clearSendingTopic(topicId)
        return
      }
      recordSendingExecutions(topicId, response)
      await refreshMessages(topicId)
      await refreshTopics(activeAssistantId)
    } catch (error) {
      setDraft(text)
      setStatusMessage(normalizeAssistantStatusMessage(error, t.modelNotReady))
      clearSendingTopic()
    }
  }

  async function handleStop(): Promise<void> {
    const topicId = activeTopicIdRef.current
    if (!topicId) return
    await window.platform.assistants.streamAbort(topicId)
    clearSendingTopic(topicId)
  }

  async function handleSelectSibling(messageId: string): Promise<void> {
    if (!activeTopicId) return
    await window.platform.assistants.setActiveNode(activeTopicId, messageId)
    await refreshMessages(activeTopicId, messageId)
  }

  async function handleDeleteMessage(messageId: string): Promise<void> {
    if (!activeTopicId) return
    try {
      const deleted = await window.platform.assistants.deleteMessage(messageId, { cascade: true, activeNodeStrategy: 'parent' })
      if (!deleted) {
        setStatusMessage(t.conversationOperationFailed)
        return
      }
      await refreshMessages(activeTopicId)
      const attached = (await window.platform.assistants.streamAttach(activeTopicId)) as {
        snapshot: AssistantTopicStreamSnapshot
      }
      setStreamSnapshot(attached.snapshot)
    } catch {
      setStatusMessage(t.conversationOperationFailed)
    }
  }

  async function handleDeleteTopic(topicId: string): Promise<void> {
    if (!activeAssistantId || deletingTopicIds.current.has(topicId)) return
    deletingTopicIds.current.add(topicId)
    try {
      const wasCurrentTopic = topicId === activeTopicId
      const previousTopics = topics
      const deleted = await window.platform.assistants.deleteTopic(topicId)
      if (!deleted) {
        setStatusMessage(t.conversationOperationFailed)
        return
      }
      const result = (await window.platform.assistants.listTopics({ assistantId: activeAssistantId })) as {
        topics: AssistantTopicEntity[]
      }
      setTopics(result.topics)
      if (wasCurrentTopic) {
        setCurrentTopicId(selectTopicAfterDeletion(previousTopics, result.topics, topicId))
      }
    } catch {
      setStatusMessage(t.conversationOperationFailed)
    } finally {
      deletingTopicIds.current.delete(topicId)
    }
  }

  async function handleRegenerate(userMessageId: string): Promise<void> {
    if (!activeTopicId || !activeAssistantId || !userMessageId) return
    setStatusMessage(null)
    beginSendingTopic(activeTopicId, false)
    try {
      const response = (await window.platform.assistants.streamOpen({
        topicId: activeTopicId,
        assistantId: activeAssistantId,
        trigger: 'regenerate-message',
        parentAnchorId: userMessageId,
        ...(mentionModels.mentionedModelIds.length > 0
          ? { mentionedModelIds: mentionModels.mentionedModelIds }
          : {})
      })) as AssistantStreamOpenResponse
      if (response.mode !== 'started' && response.mode !== 'injected') {
        setStatusMessage(response.message ?? t.modelNotReady)
        clearSendingTopic(activeTopicId)
        return
      }
      recordSendingExecutions(activeTopicId, response)
      await refreshMessages(activeTopicId)
    } catch (error) {
      setStatusMessage(normalizeAssistantStatusMessage(error, t.modelNotReady))
      clearSendingTopic(activeTopicId)
    }
  }

  async function handleEditResend(messageId: string, text: string): Promise<void> {
    if (!activeTopicId || !activeAssistantId || !text.trim()) return
    setStatusMessage(null)
    beginSendingTopic(activeTopicId, false)
    try {
      const response = (await window.platform.assistants.editAndResendUserMessage({
        topicId: activeTopicId,
        messageId,
        assistantId: activeAssistantId,
        parts: [{ type: 'text', text: text.trim() }],
        ...(mentionModels.mentionedModelIds.length > 0
          ? { mentionedModelIds: mentionModels.mentionedModelIds }
          : {})
      })) as AssistantStreamOpenResponse
      if (response.mode !== 'started' && response.mode !== 'injected') {
        setStatusMessage(response.message ?? t.modelNotReady)
        clearSendingTopic(activeTopicId)
        return
      }
      recordSendingExecutions(activeTopicId, response)
      await refreshMessages(activeTopicId)
    } catch (error) {
      setStatusMessage(normalizeAssistantStatusMessage(error, t.modelNotReady))
      clearSendingTopic(activeTopicId)
    }
  }

  async function handleSearch(query: string): Promise<void> {
    if (!activeTopicId) return
    const keyword = query.trim()
    if (!keyword) {
      setSearchHits([])
      await refreshMessages(activeTopicId)
      return
    }
    const hits = (await window.platform.assistants.searchTopicMessages(activeTopicId, keyword, 20)) as AssistantMessageEntity[]
    setSearchHits(hits)
  }

  async function handleClearTopic(): Promise<void> {
    if (!activeTopicId) return
    try {
      await window.platform.assistants.clearTopicMessages(activeTopicId)
      setMessages([])
      setSearchHits([])
      const attached = (await window.platform.assistants.streamAttach(activeTopicId)) as {
        snapshot: AssistantTopicStreamSnapshot
      }
      setStreamSnapshot(attached.snapshot)
    } catch {
      setStatusMessage(t.conversationOperationFailed)
    }
  }

  async function handleSaveAssistant(patch: {
    name?: string
    prompt?: string
    modelId?: string | null
    settings?: Partial<AssistantEntity['settings']>
  }): Promise<void> {
    if (!activeAssistantId) return
    await window.platform.assistants.update(activeAssistantId, patch)
    await refreshAssistants()
  }

  async function handleSelectAssistant(assistantId: string): Promise<void> {
    setStatusMessage(null)
    setActiveAssistantId(assistantId)
    setCurrentTopicId(null)
    setMessages([])
    setSearchHits([])
    setStreamSnapshot(null)
  }

  function handleDraftChange(value: string): void {
    if (statusMessage) setStatusMessage(null)
    setDraft(value)
  }

  // T1–T3：图像生成 / 编辑（入口在 composer；结果由主进程写成真消息）。
  const sessionImages = useMemo(() => collectAssistantImageParts(messages), [messages])
  const imageGeneration = useAssistantImageGeneration({
    providers,
    labels: t,
    failureLabels: { image: t, reason: platformText[language].models },
    topicId: activeTopic?.id ?? null,
    resolveTopicId: async () => {
      if (activeTopicIdRef.current) return activeTopicIdRef.current
      if (!activeAssistantId) return null
      // 没有话题时先生成一个：图片消息必须挂在话题上才能持久化与回看。
      const created = await createTopicForAssistant(activeAssistantId)
      return created.id
    },
    onMessagesChanged: async (topicId) => {
      await refreshMessages(topicId)
    }
  })

  function handleToolAction(toolId: AssistantInputbarToolId): void {
    if (toolId === 'new-topic') void handleCreateTopic()
    if (toolId === 'clear-topic') void handleClearTopic()
  }

  return (
    <section className="agent-page assistant-page">
      <AssistantHeader
        labels={t}
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        modelPicker={
          <ModelPicker
            pickerId="assistant-header"
            value={activeAssistant?.modelId ?? null}
            onChange={(modelId) => void handleSaveAssistant({ modelId })}
            models={modelCandidates}
            providers={providers}
            labels={platformText[language].models}
            constraints={MODEL_PICKER_ASSISTANT_CONSTRAINTS}
            placeholder={
              defaultModelLabel
                ? platformText[language].assistants.followDefaultModel(defaultModelLabel)
                : undefined
            }
          />
        }
        sidebarVisible={showSidebar}
        onSelectAssistant={(assistantId) => void handleSelectAssistant(assistantId)}
        onToggleSidebar={() => setShowSidebar((current) => !current)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className={`assistant-workspace-shell ${showSidebar ? 'with-sidebar' : ''}`}>
        {showSidebar ? (
          <AssistantSidePanel
            labels={t}
            assistants={assistants}
            topics={topics}
            activeTab={activeTab}
            activeAssistantId={activeAssistantId}
            activeTopicId={activeTopicId}
            onTabChange={setActiveTab}
            onSelectAssistant={(assistantId) => void handleSelectAssistant(assistantId)}
            onSelectTopic={(topicId) => {
              setStatusMessage(null)
              setActiveTab('topics')
              setCurrentTopicId(topicId)
            }}
            onCreateAssistant={() => void handleCreateAssistant()}
            onCreateTopic={() => void handleCreateTopic()}
            onDeleteTopic={handleDeleteTopic}
          />
        ) : null}
        <div className="assistant-workspace-main">
          <AssistantChatPane
            labels={t}
            language={language}
            topic={activeTopic}
            messages={messages}
            streamSnapshot={streamSnapshot}
            draft={draft}
            isSending={isSending}
            assistantSelected={Boolean(activeAssistant)}
            composerEnabled={composerEnabled}
            modelReady={modelReady}
            statusMessage={statusMessage}
            confirmDeleteMessage={chatSettings.confirmDeleteMessage}
            chatSettings={chatSettings}
            onDraftChange={handleDraftChange}
            onSend={() => void handleSend()}
            onStop={() => void handleStop()}
            onToolAction={handleToolAction}
            onOpenSettings={() => setSettingsOpen(true)}
            onSelectSibling={(messageId) => void handleSelectSibling(messageId)}
            onDeleteMessage={(messageId) => void handleDeleteMessage(messageId)}
            onRegenerate={(userMessageId) => void handleRegenerate(userMessageId)}
            onEditResend={(messageId, text) => void handleEditResend(messageId, text)}
            onSearch={(query) => void handleSearch(query)}
            imageGeneration={{
              target: imageGeneration.target,
              editTarget: imageGeneration.editTarget,
              isGenerating: imageGeneration.isGenerating,
              errorText: imageGeneration.errorText,
              onGenerate: imageGeneration.generate,
              onEdit: imageGeneration.edit
            }}
            pendingImage={imageGeneration.pending}
            sessionImages={sessionImages}
            mentionedModels={mentionModels.mentionedModels}
            modelOptions={mentionModels.options}
            onToggleMentionedModel={mentionModels.toggle}
            onClearMentionedModels={mentionModels.clear}
          />
        </div>
      </div>

      {searchHits.length > 0 ? (
        <aside className="assistant-search-hits" aria-label={t.searchResults}>
          {searchHits.map((hit) => (
            <button key={hit.id} type="button" className="assistant-search-hit" onClick={() => void handleSelectSibling(hit.id)}>
              <span className="assistant-search-hit-snippet">{hit.searchableText}</span>
            </button>
          ))}
        </aside>
      ) : null}

      <AssistantSettingsDrawer
        open={settingsOpen}
        labels={t}
        assistant={activeAssistant}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveAssistant}
      />
    </section>
  )
}
