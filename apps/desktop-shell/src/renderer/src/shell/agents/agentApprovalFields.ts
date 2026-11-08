import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { productApprovalFieldLabels } from '@products/generated/shellRegistry'

import type { AgentText } from './agentText'
import { resolveToolDisplayName } from './agentToolCallSummary'

export type AgentApprovalField = Readonly<{ label: string; value: string }>

/** 产品声明的标签表形状（工具名 → 字段名 → 两种语言）。生成物与测试都用这一份。 */
export type AgentApprovalLabelTable = Readonly<
  Record<string, Readonly<Record<string, { 'zh-CN': string; 'en-US': string }>>>
>

const APPROVAL_VALUE_LIMIT = 160

/**
 * 请求参数 → 字段行。
 *
 * 壳层**不认识任何产品字段名**：哪张表能画、字段叫什么，都由产品在自己的 manifest 里声明
 * （`agentApprovalFieldLabels`），生成物汇总成一张表。所以：
 * - 这个工具没人声明 → null，卡片保留原来的 JSON 摘要；
 * - 某个字段没人声明 → 也返回 null：画一半字段等于把剩下的悄悄藏起来，比不画更糟。
 *
 * 值的含义也不变：是模型请求的参数，不是写成功后的结果。
 */
export function structuredApprovalInput(
  toolName: string,
  input: unknown,
  language: AppLanguage,
  /** 默认取产品声明汇总表；测试传自己的表，壳层因此不需要认识任何产品工具名。 */
  declaredLabels: AgentApprovalLabelTable = productApprovalFieldLabels
): readonly AgentApprovalField[] | null {
  const labelTable = declaredLabels[resolveToolDisplayName(toolName)]
  if (!labelTable) return null
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined
  )
  if (entries.length === 0) return null
  const fields: AgentApprovalField[] = []
  for (const [field, value] of entries) {
    const label = labelTable[field]?.[language]
    // An unlabelled field means this card cannot be explained field by field; falling back to
    // the existing JSON summary is safer than inventing a label or dropping the field.
    if (!label) return null
    fields.push({ label, value: approvalValue(value) })
  }
  return fields
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
 * Attach the raw editor text and, for a declared capability, the labelled request rows. A card
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
  language: AppLanguage,
  text: AgentText['runtimeActivity'],
  declaredLabels: AgentApprovalLabelTable = productApprovalFieldLabels
): void {
  for (const [key, card] of cards.entries()) {
    if (card.kind !== 'approval' || !card.toolCallId) continue
    const approvalInput = approvalInputByToolCallId.get(card.toolCallId)
    if (!approvalInput) continue
    const fields = structuredApprovalInput(card.title, approvalInput.input, language, declaredLabels)
    cards.set(key, {
      ...card,
      ...(card.approvalInputText ? {} : { approvalInputText: approvalInput.text }),
      ...(fields ? { approvalNotice: text.approvalRequestParamsNotice, approvalFields: fields } : {})
    })
  }
}
