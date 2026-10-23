import type { ReactNode } from 'react'

export type AgentQuickPanelGroup = 'commands' | 'models' | 'actions'
export type AgentQuickPanelMode = '/' | '@'

export type AgentQuickPanelItem = {
  id: string
  label: string
  description: string
  keywords?: string[]
  group: AgentQuickPanelGroup
  sectionKey?: string
  sectionLabel?: string
  filterText?: string
  icon?: ReactNode
  selected?: boolean
  alwaysVisible?: boolean
  /** 领域自定义匹配（模型项走 `modelPickerOptions` 的模糊匹配，避免第四套实现）。 */
  matchQuery?: (query: string) => boolean
}

export type AgentQuickPanelTrigger = {
  symbol: AgentQuickPanelMode
  start: number
  end: number
  query: string
}

export type AgentQuickPanelManualState = {
  mode: AgentQuickPanelMode
  query: string
}

export function resolveAgentQuickPanelMode(
  trigger: AgentQuickPanelTrigger | null,
  manualState: AgentQuickPanelManualState | null
): AgentQuickPanelMode | null {
  return manualState?.mode ?? trigger?.symbol ?? null
}

export function resolveAgentQuickPanelQuery(
  trigger: AgentQuickPanelTrigger | null,
  manualState: AgentQuickPanelManualState | null
): string {
  return manualState?.query ?? trigger?.query ?? ''
}

export function shouldKeepAgentQuickPanelOpenAfterSelection(
  mode: AgentQuickPanelMode | null,
  itemId: string
): boolean {
  return mode === '@' && itemId.startsWith('mention:')
}

export function shouldCloseAgentQuickPanelFromButton(
  open: boolean,
  currentMode: AgentQuickPanelMode | null,
  nextMode: AgentQuickPanelMode
): boolean {
  return open && currentMode === nextMode
}

export function shouldDismissAgentQuickPanelFromKey(open: boolean, key: string): boolean {
  return open && key === 'Escape'
}

export function shouldDismissAgentQuickPanelFromOutsidePointer(
  open: boolean,
  pointerTargetIsInsideInputbar: boolean
): boolean {
  return open && !pointerTargetIsInsideInputbar
}

export function findAgentQuickPanelTrigger(text: string, selectionStart: number): AgentQuickPanelTrigger | null {
  const prefix = text.slice(0, selectionStart)
  const slashMatch = prefix.match(/(^|\s)(\/[^\s]*)$/)
  const mentionMatch = prefix.match(/(^|\s)(@[^\s]*)$/)
  const token = selectLatestTrigger(slashMatch?.[2], mentionMatch?.[2])
  if (!token) return null

  return {
    symbol: token[0] === '@' ? '@' : '/',
    start: prefix.length - token.length,
    end: selectionStart,
    query: token.slice(1)
  }
}

export function filterAgentQuickPanelItems(
  items: readonly AgentQuickPanelItem[],
  query: string
): AgentQuickPanelItem[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...items]
  const alwaysVisibleItems = items.filter((item) => item.alwaysVisible)
  const normalItems = items.filter((item) => !item.alwaysVisible)

  return [
    ...alwaysVisibleItems,
    ...normalItems
    .map((item) => ({
      item,
      rank: getAgentQuickPanelItemRank(item, normalizedQuery)
    }))
    .filter((entry) => entry.rank !== Number.POSITIVE_INFINITY)
    .sort((left, right) => left.rank - right.rank || left.item.label.localeCompare(right.item.label))
    .map((entry) => entry.item)
  ]
}

export function getNextAgentQuickPanelIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return (current + delta + count) % count
}

function getAgentQuickPanelItemRank(item: AgentQuickPanelItem, query: string): number {
  // 领域匹配（模型项）先当闸门；通过后再按名字/关键字排优先级。
  if (item.matchQuery && !item.matchQuery(query)) return Number.POSITIVE_INFINITY
  const label = (item.filterText ?? item.label).toLowerCase()
  const description = item.description.toLowerCase()
  const keywords = item.keywords?.map((keyword) => keyword.toLowerCase()) ?? []

  if (label.startsWith(query)) return 0
  if (label.includes(query)) return 1
  if (keywords.some((keyword) => keyword.startsWith(query))) return 2
  if (keywords.some((keyword) => keyword.includes(query))) return 3
  if (description.includes(query)) return 4
  // 只被模糊匹配命中（例如 `dsv3`）的项排在明确命中之后，但仍可见。
  if (item.matchQuery) return 5
  return Number.POSITIVE_INFINITY
}

function selectLatestTrigger(slashToken?: string, mentionToken?: string): string | null {
  if (slashToken && mentionToken) {
    return slashToken.length >= mentionToken.length ? slashToken : mentionToken
  }
  return slashToken ?? mentionToken ?? null
}
