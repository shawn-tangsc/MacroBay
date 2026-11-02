import { useEffect } from 'react'
import type { RefObject } from 'react'

import { buildAgentQuoteInsertion } from '../agentSelectionContext'
import { resizeTextarea } from './agentInputbarHelpers'

type UseQuotedToComposerInput = {
  draftRef: RefObject<string>
  setDraft: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  maxTextareaHeight: number
}

/**
 * 「引用到主窗口」进来的那段文字，落到 composer 的草稿里并把光标放到末尾。
 *
 * 抽出来只为一件事：输入条本体已经贴着 360 行的架构边界，这段是自成一体的订阅——
 * 它只关心草稿、光标和一次重排，和「输入条怎么摆」无关。
 */
export function useQuotedToComposer({
  draftRef,
  setDraft,
  textareaRef,
  maxTextareaHeight
}: UseQuotedToComposerInput): void {
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
  }, [draftRef, maxTextareaHeight, setDraft, textareaRef])
}
