import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import { buildAgentInputQuickPanelItems } from './agentInputQuickPanelItems'
import {
  filterAgentQuickPanelItems,
  findAgentQuickPanelTrigger,
  resolveAgentQuickPanelMode,
  resolveAgentQuickPanelQuery,
  shouldCloseAgentQuickPanelFromButton,
  shouldKeepAgentQuickPanelOpenAfterSelection,
  type AgentQuickPanelItem,
  type AgentQuickPanelManualState,
  type AgentQuickPanelMode
} from './agentQuickPanel'
import { applyAgentSlashCommandInsertion } from './agentSlashCommandInsertion'
import type { AgentText } from './agentTextTypes'

type SlashCommandItem = {
  command: string
  description: string
}

type UseAgentInputQuickPanelInput = {
  text: AgentText
  expanded: boolean
  slashCommands: readonly SlashCommandItem[]
  draftRef: MutableRefObject<string>
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  setDraft: Dispatch<SetStateAction<string>>
  onAddFiles: () => Promise<void>
  onInsertText: (value: string) => void
  onToggleExpanded: () => void
  onOpenTools: () => void
  onClearMessages: () => void
  mentionItems: readonly AgentQuickPanelItem[]
  onToggleMentionModel: (itemId: string) => void
  onClearMentionModels: () => void
  onOpenModelService: () => void
  onRemoveMentionTrigger: (text: string, selectionStart: number, triggerStart?: number | null) => string
  onExecuteRuntimeCommand?: (command: '/context' | '/cost' | '/todos') => Promise<void> | void
}

export function useAgentInputQuickPanel(input: UseAgentInputQuickPanelInput) {
  const [cursorPosition, setCursorPosition] = useState(input.draftRef.current.length)
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [manualState, setManualState] = useState<AgentQuickPanelManualState | null>(null)
  const slashPromptMapRef = useRef<Record<string, string>>({
    '/compact': 'Please compact the current conversation into a concise working summary.'
  })
  const runtimeCommandSet = useRef(new Set(['/context', '/cost', '/todos']))

  const trigger = useMemo(() => findAgentQuickPanelTrigger(input.draftRef.current, cursorPosition), [cursorPosition, input.draftRef])
  const signature = trigger ? `${trigger.symbol}:${trigger.start}:${trigger.end}:${trigger.query}` : null
  const mode = resolveAgentQuickPanelMode(trigger, manualState)
  const query = resolveAgentQuickPanelQuery(trigger, manualState)
  const items = useMemo(
    () => {
      const source =
        mode === '@'
          ? input.mentionItems
          : buildAgentInputQuickPanelItems({
              text: input.text,
              expanded: input.expanded,
              slashCommands: input.slashCommands
            })
      return filterAgentQuickPanelItems(source, query)
    },
    [input.expanded, input.mentionItems, input.slashCommands, input.text, mode, query]
  )
  const open = mode !== null && (manualState !== null || signature !== dismissedSignature)

  useEffect(() => {
    if (manualState === null && signature !== dismissedSignature) {
      setDismissedSignature(null)
    }
  }, [dismissedSignature, manualState, signature])

  useEffect(() => {
    if (!open) {
      setActiveId(null)
      return
    }

    if (!activeId || !items.some((item) => item.id === activeId)) {
      setActiveId(items[0]?.id ?? null)
    }
  }, [activeId, items, open])

  function syncCursorPosition(): void {
    const textarea = input.textareaRef.current
    if (!textarea) return
    setCursorPosition(textarea.selectionStart ?? input.draftRef.current.length)
  }

  function applySlashInsertion(insertion: string): void {
    const textarea = input.textareaRef.current
    const next = applyAgentSlashCommandInsertion({
      text: input.draftRef.current,
      selectionStart: textarea?.selectionStart ?? input.draftRef.current.length,
      selectionEnd: textarea?.selectionEnd ?? input.draftRef.current.length,
      insertion
    })

    input.draftRef.current = next.text
    input.setDraft(next.text)
    requestAnimationFrame(() => {
      input.textareaRef.current?.focus()
      input.textareaRef.current?.setSelectionRange(next.caret, next.caret)
      setCursorPosition(next.caret)
    })
  }

  async function handleSelection(itemId: string): Promise<void> {
    const activeMode = mode
    if (!activeMode) return

    const keepOpen = shouldKeepAgentQuickPanelOpenAfterSelection(activeMode, itemId)
    if (!keepOpen) {
      setManualState(null)
      if (signature) setDismissedSignature(signature)
    }

    if (activeMode === '@' && itemId.startsWith('mention:')) {
      input.onToggleMentionModel(itemId)
      if (trigger?.symbol === '@') {
        const nextText = input.onRemoveMentionTrigger(
          input.draftRef.current,
          input.textareaRef.current?.selectionStart ?? input.draftRef.current.length,
          trigger.start
        )
        input.draftRef.current = nextText
        input.setDraft(nextText)
        requestAnimationFrame(() => {
          const nextCaret = input.textareaRef.current?.selectionStart ?? nextText.length
          input.textareaRef.current?.focus()
          input.textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
          setCursorPosition(nextCaret)
        })
      }
      if (keepOpen) {
        setManualState((current) => ({ mode: '@', query: current?.mode === '@' ? current.query : '' }))
      }
      if (!keepOpen) {
        requestAnimationFrame(() => {
          input.textareaRef.current?.focus()
          const nextCaret = input.textareaRef.current?.selectionStart ?? input.draftRef.current.length
          input.textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
          setCursorPosition(nextCaret)
        })
      }
      return
    }

    if (itemId.startsWith('command:')) {
      const command = itemId.replace('command:', '')
      if (command === '/clear') {
        applySlashInsertion('')
        input.onClearMessages()
        return
      }
      if (runtimeCommandSet.current.has(command) && input.onExecuteRuntimeCommand) {
        applySlashInsertion('')
        await input.onExecuteRuntimeCommand(command as '/context' | '/cost' | '/todos')
        return
      }
      const prompt = slashPromptMapRef.current[command] ?? `${command} `
      applySlashInsertion(`${prompt}\n`)
      return
    }

    applySlashInsertion('')

    if (itemId === 'action:tools') {
      input.onOpenTools()
      return
    }
    if (itemId === 'action:attachment') {
      await input.onAddFiles()
      return
    }
    if (itemId === 'action:mention') {
      setManualState({ mode: '@', query: '' })
      return
    }
    if (itemId === 'action:clear-mentioned-models') {
      input.onClearMentionModels()
      if (trigger?.symbol === '@') {
        const nextText = input.onRemoveMentionTrigger(
          input.draftRef.current,
          input.textareaRef.current?.selectionStart ?? input.draftRef.current.length,
          trigger.start
        )
        input.draftRef.current = nextText
        input.setDraft(nextText)
      }
      return
    }
    if (itemId === 'action:open-model-service') {
      input.onOpenModelService()
      return
    }
    if (itemId === 'action:expand') {
      input.onToggleExpanded()
      return
    }
    if (itemId === 'action:clear') {
      input.onClearMessages()
    }
  }

  function openFromButton(): void {
    openFromTrigger('/')
  }

  function openMentionFromButton(): void {
    openFromTrigger('@')
  }

  function openFromTrigger(symbol: AgentQuickPanelMode): void {
    if (shouldCloseAgentQuickPanelFromButton(open, mode, symbol)) {
      setManualState(null)
      if (signature) setDismissedSignature(signature)
      return
    }

    setManualState({ mode: symbol, query: '' })
    requestAnimationFrame(() => {
      const nextCaret = input.textareaRef.current?.selectionStart ?? input.draftRef.current.length
      input.textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
      setCursorPosition(nextCaret)
      setDismissedSignature(null)
    })
  }

  return {
    activeId,
    items,
    mode: mode ?? '/',
    open,
    searchValue: manualState?.query ?? '',
    showSearch: manualState !== null,
    setActiveId,
    setCursorPosition,
    setSearchValue: (value: string) =>
      setManualState((current) => (current ? { ...current, query: value } : current)),
    syncCursorPosition,
    dismiss: () => {
      setManualState(null)
      if (signature) setDismissedSignature(signature)
    },
    handleSelection,
    openFromButton,
    openMentionFromButton
  }
}
