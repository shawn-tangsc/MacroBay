import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { claudeCodeBuiltinTools } from '@platform/ai/agent-platform/tools/builtinClaudeTools'
import { getBuiltinSlashCommands } from '@platform/ai/agent-platform/tools/slashCommands'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ChatSettings } from '@platform/settings/schema/appSettings'
import { isSoulModeEnabled } from '@platform/ai/agent-platform/schemas/agentSchemas'
import { AgentChatComposer } from '@platform/ui/agent-chat'

import { clearSessionMessages, setAgentToolEnabled } from '../agentStateActions'
import { supportsVisionAttachments } from '../agentAttachmentPolicy'
import { readAgentAttachedFile } from '../agentInputbarAttachments'
import { buildAgentMessageText, type AgentAttachedFile } from '../agentMessageInput'
import type { AgentComposedMessage } from '../agentMessageSendFlow'
import { buildAgentQuoteInsertion } from '../agentSelectionContext'
import { useAgentMentionModels } from '../useAgentMentionModels'
import {
  cancelSessionViaApi,
  clearSessionMessagesViaApi,
  executeRuntimeCommandViaApi,
  setAgentToolEnabledViaApi
} from '../agentSessionDataApi'
import { useAgentLanguage, useAgentText } from '../agentTextProvider'
import { inputbarFooterLabels, mentionModelText } from './agentInputbarText'
import { openModelServiceSettings } from '../../model-service/openModelServiceSettings'
import { useAgentInputQuickPanel } from '../useAgentInputQuickPanel'
import {
  canSubmitAgentInput,
  getAgentTextareaMaxHeight,
  toggleAgentInputExpanded
} from './agentInputbarControls'
import { isSendShortcut, resizeTextarea } from './agentInputbarHelpers'
import AgentQuickPanel, { getAgentQuickPanelNextActiveId } from './AgentQuickPanel'
import AgentSessionInputbarFooter from './AgentSessionInputbarFooter'
import AgentComposerModelMenu from './AgentComposerModelMenu'
import AgentSessionInputbarNotices from './AgentSessionInputbarNotices'
import { readClipboardImageAttachment } from './agentClipboardAttachment'
import { useAgentQuickPanelDismiss } from './useAgentQuickPanelDismiss'
import { useAgentDraftBuffer } from './useAgentDraftBuffer'
import { useAgentSessionSend } from './useAgentSessionSend'

type AgentSessionInputbarProps = {
  agent: AgentEntity
  session: AgentSessionEntity
  providers: SafeModelProvider[]
  pinnedModelIds: string[]
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  defaultAgentModelId?: string
  isStreaming: boolean
  chatSettings: ChatSettings | null
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  /** Overrides the draft buffer key (an embedded surface keys it per session). */
  draftStorageKey?: string
  /** Appends the mounting surface's locked context at send time. */
  composeText?: (text: string) => AgentComposedMessage | Promise<AgentComposedMessage>
  /** The host blocks composition while its own selection is unresolved. */
  disabled?: boolean
}

export default function AgentSessionInputbar({
  agent,
  session,
  providers,
  pinnedModelIds,
  compatibilityByModelKey,
  defaultAgentModelId,
  isStreaming,
  chatSettings,
  onStateChange,
  draftStorageKey: draftStorageKeyOverride,
  composeText,
  disabled = false
}: AgentSessionInputbarProps): React.ReactElement {
  const t = useAgentText()
  const draftStorageKey = draftStorageKeyOverride ?? `agent-session-draft:${agent.id}`
  const { draft, setDraft, draftRef } = useAgentDraftBuffer(draftStorageKey)
  const [files, setFiles] = useState<AgentAttachedFile[]>([])
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const inputbarRef = useRef<HTMLFormElement | null>(null)
  const mentionModels = useAgentMentionModels({
    providers,
    agentType: agent.type,
    pinnedModelIds,
    compatibilityByModelKey,
    language: useAgentLanguage(),
    text: mentionModelText(t)
  })
  const canSend = !disabled && canSubmitAgentInput({ draft, fileCount: files.length })
  const maxTextareaHeight = getAgentTextareaMaxHeight(expanded)
  const slashCommands = useMemo(() => getBuiltinSlashCommands(agent.type), [agent.type])
  const builtinTools = useMemo(() => [...claudeCodeBuiltinTools], [])
  const placeholder = isSoulModeEnabled(agent.configuration) ? t.input.soulPlaceholder : t.input.placeholder
  const allowImageAttachments = useMemo(() => supportsVisionAttachments(agent.model, providers), [agent.model, providers])
  const activeToolSummary = useMemo(() => {
    const disabled = new Set(agent.disabledTools ?? [])
    const enabled = builtinTools.filter((tool) => !disabled.has(tool.id))
    return t.input.builtinToolsEnabled(enabled.length, builtinTools.length)
  }, [agent.disabledTools, builtinTools, t.input])
  const footerLabels = useMemo(() => inputbarFooterLabels(t), [t])

  useEffect(() => {
    return window.platform.app.onQuotedToMain((selectedText) => {
      const insertion = buildAgentQuoteInsertion(draftRef.current, selectedText)
      if (!insertion) return

      const nextDraft = `${draftRef.current}${insertion}`
      draftRef.current = nextDraft
      setDraft(nextDraft)
      requestAnimationFrame(() => {
        if (textareaRef.current) resizeTextarea(textareaRef.current, maxTextareaHeight)
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(nextDraft.length, nextDraft.length)
      })
    })
  }, [maxTextareaHeight])

  const quickPanel = useAgentInputQuickPanel({
    text: t,
    expanded,
    slashCommands,
    draftRef,
    textareaRef,
    setDraft: (value) => setDraft(value),
    onAddFiles: addFiles,
    onInsertText: insertText,
    onToggleExpanded: toggleExpanded,
    onOpenTools: () => setToolsOpen(true),
    onClearMessages: () => {
      if (window.confirm(t.input.confirmClearMessages(session.name))) {
        void clearSessionMessagesViaApi(window.platform, session.id).catch(() => {
          onStateChange((current) => clearSessionMessages(current, session.id))
        })
      }
    },
    mentionItems: mentionModels.mentionItems,
    onToggleMentionModel: mentionModels.toggleByItemId,
    onClearMentionModels: mentionModels.clear,
    onOpenModelService: openModelServiceSettings,
    onRemoveMentionTrigger: mentionModels.cleanTriggerText,
    onExecuteRuntimeCommand: async (command) => {
      try {
        const result = await executeRuntimeCommandViaApi(window.platform, {
          command,
          agentId: agent.id,
          sessionId: session.id
        })
        onStateChange(() => result.state)
      } catch {
        // Best-effort command execution; leave draft cleared already.
      }
    }
  })

  useAgentQuickPanelDismiss({
    open: quickPanel.open,
    inputbarRef,
    onDismiss: () => {
      quickPanel.dismiss()
      setToolsOpen(false)
    }
  })

  const { send, sendError } = useAgentSessionSend({
    agent,
    session,
    draft,
    files,
    mentionedModels: mentionModels.mentionedModels,
    maxTextareaHeight,
    textareaRef,
    draftRef,
    setDraft,
    setFiles,
    onStateChange,
    ...(composeText ? { composeText } : {})
  })

  async function stop(): Promise<void> {
    await cancelSessionViaApi(window.platform, session.id)
  }

  function updateDraft(event: ChangeEvent<HTMLTextAreaElement>): void {
    const nextValue = event.target.value
    setDraft(nextValue)
    quickPanel.setCursorPosition(event.target.selectionStart ?? nextValue.length)
    resizeTextarea(event.target, maxTextareaHeight)
  }

  function toggleExpanded(): void {
    const nextExpanded = toggleAgentInputExpanded(expanded)
    setExpanded(nextExpanded)
    requestAnimationFrame(() => {
      if (textareaRef.current) resizeTextarea(textareaRef.current, getAgentTextareaMaxHeight(nextExpanded))
      textareaRef.current?.focus()
    })
  }

  async function addFiles(): Promise<void> {
    const paths = (await window.platform.app.selectFiles()) as string[]
    const nextFiles = await Promise.all(paths.map((path) => readAgentAttachedFile(path, allowImageAttachments)))
    setFiles((current) => [...current, ...nextFiles])
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      quickPanel.syncCursorPosition()
    })
  }

  async function attachClipboardImage(file: File): Promise<void> {
    setPasteError(null)
    try {
      const attached = await readClipboardImageAttachment(file, allowImageAttachments)
      setFiles((current) => [...current, attached])
    } catch {
      setPasteError(t.input.clipboardImageFailed)
    }
  }

  function insertText(value: string): void {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? draft.length
    const next = `${draft.slice(0, start)}${value}${draft.slice(end)}`
    setDraft(next)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const nextCaret = start + value.length
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
      quickPanel.setCursorPosition(nextCaret)
    })
  }

  function setToolEnabled(toolId: string, enabled: boolean): void {
    void setAgentToolEnabledViaApi(window.platform, agent, toolId, enabled).catch(() => {
      onStateChange((current) => setAgentToolEnabled(current, agent.id, toolId, enabled))
    })
  }

  return (
    <AgentChatComposer
      formRef={inputbarRef}
      className={`${expanded ? 'agent-inputbar expanded' : 'agent-inputbar'}${chatSettings?.narrowMode ? ' narrow' : ''}`}
      value={draft}
      onChange={setDraft}
      disabled={disabled}
      onSubmit={() => { if (canSend) void send() }}
      labels={{ send: t.input.send, sending: t.input.send, stop: t.input.stop }}
      ariaLabel={t.input.placeholder}
      input={<>
      <AgentSessionInputbarNotices
        files={files}
        mentionedModels={mentionModels.mentionedModels}
        sendError={sendError}
        pasteError={pasteError}
        text={t.input}
        onRemoveFile={(path) => setFiles((current) => current.filter((item) => item.path !== path))}
        onRemoveMentionedModel={mentionModels.removeByValue}
      />
      <textarea
        ref={textareaRef}
        value={draft}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        onChange={updateDraft}
        onPaste={(event) => {
          const imageItem = [...event.clipboardData.items].find(
            (item) => item.kind === 'file' && item.type.startsWith('image/')
          )
          const file = imageItem?.getAsFile()
          if (!file) return
          event.preventDefault()
          void attachClipboardImage(file)
        }}
        onClick={quickPanel.syncCursorPosition}
        onKeyUp={quickPanel.syncCursorPosition}
        onSelect={quickPanel.syncCursorPosition}
        onKeyDown={(event) => {
          if (quickPanel.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            quickPanel.setActiveId((current) =>
              getAgentQuickPanelNextActiveId(quickPanel.items, current, event.key === 'ArrowDown' ? 1 : -1)
            )
            return
          }
          if (quickPanel.open && event.key === 'Enter' && !isSendShortcut(event, chatSettings?.sendShortcut ?? 'enter')) {
            const selectedId = quickPanel.activeId ?? quickPanel.items[0]?.id
            if (selectedId) {
              event.preventDefault()
              void quickPanel.handleSelection(selectedId)
            }
            return
          }
          if (isSendShortcut(event, chatSettings?.sendShortcut ?? 'enter')) {
            event.preventDefault()
            void send()
          }
          if (event.key === 'Escape') {
            quickPanel.dismiss()
            setToolsOpen(false)
          }
        }}
      />
      <AgentQuickPanel
        title={quickPanel.mode === '@' ? t.input.mentionModel : t.input.commands}
        commandsLabel={t.input.commands}
        modelsLabel={t.input.mentionedModels}
        actionsLabel={t.input.quickActions}
        emptyLabel={t.input.quickPanelEmpty}
        items={quickPanel.items}
        open={quickPanel.open}
        activeId={quickPanel.activeId}
        showSearch={quickPanel.showSearch}
        searchValue={quickPanel.searchValue}
        searchPlaceholder={quickPanel.mode === '@' ? t.input.mentionModelPlaceholder : t.input.quickPanelSearchPlaceholder}
        onActiveIdChange={quickPanel.setActiveId}
        onDismiss={quickPanel.dismiss}
        onSearchChange={quickPanel.setSearchValue}
        onSelect={(item) => void quickPanel.handleSelection(item.id)}
      />
      <AgentSessionInputbarFooter
        agent={agent}
        expanded={expanded}
        toolsOpen={toolsOpen}
        isStreaming={isStreaming}
        canSend={canSend}
        activeToolSummary={activeToolSummary}
        builtinTools={builtinTools}
        modelPicker={
          <AgentComposerModelMenu
            agent={agent}
            providers={providers}
            compatibilityByModelKey={compatibilityByModelKey}
            defaultAgentModelId={defaultAgentModelId}
            onStateChange={onStateChange}
          />
        }
        labels={footerLabels}
        onToolsOpenChange={setToolsOpen}
        onMentionClick={quickPanel.openMentionFromButton}
        onAddFiles={() => void addFiles()}
        onToggleTool={setToolEnabled}
        onOpenCommands={quickPanel.openFromButton}
        onToggleExpanded={toggleExpanded}
        onStop={() => void stop()}
        onSend={() => void send()}
      />
      </>}
      actions={<></>}
    />
  )
}
