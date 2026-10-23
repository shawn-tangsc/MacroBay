import { readSelectedText } from '../selectionText'

export const readAgentSelectedText = readSelectedText

export function buildAgentQuotedSelectionText(text: string): string {
  return `<blockquote>\n\n${text}\n</blockquote>\n`
}

export function buildAgentQuoteInsertion(currentDraft: string, selectedText: string): string {
  const trimmedSelection = selectedText.trim()
  if (!trimmedSelection) return ''

  const quoted = buildAgentQuotedSelectionText(trimmedSelection)
  return currentDraft ? `\n${quoted}\n` : `${quoted}\n`
}
