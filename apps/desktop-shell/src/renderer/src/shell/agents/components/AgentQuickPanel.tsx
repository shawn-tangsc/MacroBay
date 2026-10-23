import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'

import type { AgentQuickPanelItem } from '../agentQuickPanel'
import { getNextAgentQuickPanelIndex } from '../agentQuickPanel'

type AgentQuickPanelProps = {
  title: string
  commandsLabel: string
  modelsLabel: string
  actionsLabel: string
  emptyLabel: string
  items: AgentQuickPanelItem[]
  open: boolean
  activeId: string | null
  showSearch: boolean
  searchValue: string
  searchPlaceholder: string
  onActiveIdChange: (id: string | null) => void
  onDismiss: () => void
  onSearchChange: (value: string) => void
  onSelect: (item: AgentQuickPanelItem) => void
}

export default function AgentQuickPanel({
  title,
  commandsLabel,
  modelsLabel,
  actionsLabel,
  emptyLabel,
  items,
  open,
  activeId,
  showSearch,
  searchValue,
  searchPlaceholder,
  onActiveIdChange,
  onDismiss,
  onSearchChange,
  onSelect
}: AgentQuickPanelProps): React.ReactElement | null {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const groupedItems = useMemo(
    () => buildQuickPanelSections(items, { commands: commandsLabel, models: modelsLabel, actions: actionsLabel }),
    [actionsLabel, commandsLabel, items, modelsLabel]
  )

  useEffect(() => {
    if (!open) {
      setHoveredId(null)
      return
    }

    if (items.length === 0) {
      onActiveIdChange(null)
      return
    }

    if (!activeId || !items.some((item) => item.id === activeId)) {
      onActiveIdChange(items[0].id)
    }
  }, [activeId, items, onActiveIdChange, open])

  useEffect(() => {
    if (open && showSearch) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [open, showSearch])

  useEffect(() => {
    const searchInput = searchInputRef.current
    if (!open || !showSearch || !searchInput) return
    if (document.activeElement === searchInput) return

    searchInput.focus()
    const caret = searchInput.value.length
    searchInput.setSelectionRange(caret, caret)
  }, [items, open, showSearch])

  if (!open) return null

  return (
    <div className="agent-quick-panel" role="listbox" aria-label={title}>
      <div className="agent-quick-panel-header">
        <strong>{title}</strong>
      </div>
      {showSearch ? (
        <label className="agent-quick-panel-search">
          <input
            ref={searchInputRef}
            value={searchValue}
            placeholder={searchPlaceholder}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                onActiveIdChange(
                  getAgentQuickPanelNextActiveId(items, activeId, event.key === 'ArrowDown' ? 1 : -1)
                )
                return
              }
              if (event.key === 'Enter') {
                const selectedId = activeId ?? items[0]?.id
                const selected = items.find((item) => item.id === selectedId)
                if (selected) {
                  event.preventDefault()
                  onSelect(selected)
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onDismiss()
              }
            }}
          />
        </label>
      ) : null}
      <div className="agent-quick-panel-list">
        {items.length === 0 ? <div className="agent-quick-panel-empty">{emptyLabel}</div> : null}
        {groupedItems.map((group) =>
          group.items.length > 0 ? (
            <div key={group.key} className="agent-quick-panel-group">
              <span className="agent-quick-panel-group-label">{group.label}</span>
              {group.items.map((item) => {
                const active = item.id === (hoveredId ?? activeId)
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? 'agent-quick-panel-item active' : 'agent-quick-panel-item'}
                    onMouseEnter={() => {
                      setHoveredId(item.id)
                      onActiveIdChange(item.id)
                    }}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => onSelect(item)}>
                    <div className="agent-quick-panel-item-main">
                      {item.icon ? <span className="agent-quick-panel-item-icon">{item.icon}</span> : null}
                      <span className="agent-quick-panel-item-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                    </div>
                    {item.selected ? (
                      <span className="agent-quick-panel-item-check" aria-hidden="true">
                        <Check size={13} />
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null
        )}
      </div>
    </div>
  )
}

type QuickPanelSection = {
  key: string
  label: string
  group: AgentQuickPanelItem['group']
  items: AgentQuickPanelItem[]
}

function buildQuickPanelSections(
  items: readonly AgentQuickPanelItem[],
  fallbackLabels: Record<AgentQuickPanelItem['group'], string>
): QuickPanelSection[] {
  if (items.length === 0) return []

  const sections: QuickPanelSection[] = []
  let currentSectionKey: string | null = null
  let currentSectionLabel = ''
  let currentGroup: AgentQuickPanelItem['group'] | null = null
  let currentItems: AgentQuickPanelItem[] = []

  for (const item of items) {
    const sectionKey = item.sectionKey ?? `${item.group}:default`
    const sectionLabel = item.sectionLabel ?? fallbackLabels[item.group]
    if (currentSectionKey !== sectionKey) {
      if (currentItems.length > 0) {
        sections.push({
          key: currentSectionKey ?? `${currentGroup ?? item.group}:default`,
          label: currentSectionLabel,
          group: currentGroup ?? item.group,
          items: currentItems
        })
      }
      currentSectionKey = sectionKey
      currentSectionLabel = sectionLabel
      currentGroup = item.group
      currentItems = [item]
      continue
    }
    currentItems.push(item)
  }

  if (currentItems.length > 0) {
    sections.push({
      key: currentSectionKey ?? `${currentGroup ?? currentItems[0]?.group ?? 'actions'}:default`,
      label: currentSectionLabel,
      group: currentGroup ?? currentItems[0]?.group ?? 'actions',
      items: currentItems
    })
  }

  return sections
}

export function getAgentQuickPanelNextActiveId(
  items: AgentQuickPanelItem[],
  currentId: string | null,
  delta: 1 | -1
): string | null {
  if (items.length === 0) return null
  const currentIndex = currentId ? items.findIndex((item) => item.id === currentId) : -1
  const nextIndex = getNextAgentQuickPanelIndex(currentIndex, delta, items.length)
  return nextIndex >= 0 ? items[nextIndex].id : null
}
