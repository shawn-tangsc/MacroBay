import type { AgentText } from './agentText'
import { resolveToolDisplayName } from './agentToolCallSummary'

export type AgentApprovalField = Readonly<{ label: string; value: string }>

/** The product write tools whose request parameters the approval card can label. */
const LABELLED_APPROVAL_CAPABILITIES = new Set([
  'configure_intelligence_source',
  'operate_intelligence_source',
  'operate_macro_calendar',
  'configure_translation',
  'configure_cross_asset_interface'
])
const APPROVAL_VALUE_LIMIT = 160

/**
 * Known product write capability -> its input as field/value rows. The values are what the model
 * asked for, never what the write produced; an unknown field keeps its raw key rather than
 * disappearing, and an unknown capability returns null so the card keeps its existing summary.
 */
export function structuredApprovalInput(
  toolName: string,
  input: unknown,
  text: AgentText['runtimeActivity']
): readonly AgentApprovalField[] | null {
  if (!LABELLED_APPROVAL_CAPABILITIES.has(resolveToolDisplayName(toolName))) return null
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined
  )
  if (entries.length === 0) return null
  return entries.map(([field, value]) => ({
    label: text.approvalFieldLabels[field] ?? field,
    value: approvalValue(value)
  }))
}

function approvalValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return truncateApprovalValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return truncateApprovalValue(
      value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ')
    )
  }
  try {
    return truncateApprovalValue(JSON.stringify(value))
  } catch {
    return '—'
  }
}

function truncateApprovalValue(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > APPROVAL_VALUE_LIMIT
    ? `${oneLine.slice(0, APPROVAL_VALUE_LIMIT).trimEnd()}…`
    : oneLine
}

/**
 * Attach the raw editor text and, for a listed capability, the labelled request rows. A card
 * without matching tool input is left untouched so an unknown tool keeps its current rendering.
 */
export function attachApprovalInputs<
  TCard extends {
    kind: string
    toolCallId: string | null
    title: string
    approvalInputText?: string | null
  }
>(
  cards: Map<string, TCard>,
  approvalInputByToolCallId: Map<string, { text: string; input: unknown }>,
  text: AgentText['runtimeActivity']
): void {
  for (const [key, card] of cards.entries()) {
    if (card.kind !== 'approval' || !card.toolCallId) continue
    const approvalInput = approvalInputByToolCallId.get(card.toolCallId)
    if (!approvalInput) continue
    const fields = structuredApprovalInput(card.title, approvalInput.input, text)
    cards.set(key, {
      ...card,
      ...(card.approvalInputText ? {} : { approvalInputText: approvalInput.text }),
      ...(fields ? { approvalNotice: text.approvalRequestParamsNotice, approvalFields: fields } : {})
    })
  }
}
