import { describe, expect, it } from 'vitest'

import {
  filterAgentQuickPanelItems,
  findAgentQuickPanelTrigger,
  getNextAgentQuickPanelIndex,
  resolveAgentQuickPanelMode,
  resolveAgentQuickPanelQuery,
  shouldCloseAgentQuickPanelFromButton,
  shouldDismissAgentQuickPanelFromKey,
  shouldDismissAgentQuickPanelFromOutsidePointer,
  shouldKeepAgentQuickPanelOpenAfterSelection,
  type AgentQuickPanelItem
} from './agentQuickPanel'

const items: AgentQuickPanelItem[] = [
  {
    id: 'compact',
    label: '/compact',
    description: 'Compact the current conversation',
    keywords: ['summary'],
    group: 'commands'
  },
  {
    id: 'context',
    label: '/context',
    description: 'Summarize current context',
    keywords: ['session'],
    group: 'commands'
  },
  {
    id: 'workspace',
    label: 'Insert workspace',
    description: 'Insert the current workspace path',
    keywords: ['folder'],
    group: 'actions'
  }
]

describe('findAgentQuickPanelTrigger', () => {
  it('detects a slash trigger at the start of the draft', () => {
    expect(findAgentQuickPanelTrigger('/cont', 5)).toEqual({
      symbol: '/',
      start: 0,
      end: 5,
      query: 'cont'
    })
  })

  it('detects a slash trigger after whitespace', () => {
    expect(findAgentQuickPanelTrigger('hello /cont', 11)).toEqual({
      symbol: '/',
      start: 6,
      end: 11,
      query: 'cont'
    })
  })

  it('detects a mention trigger after whitespace', () => {
    expect(findAgentQuickPanelTrigger('ask @cla', 8)).toEqual({
      symbol: '@',
      start: 4,
      end: 8,
      query: 'cla'
    })
  })

  it('ignores slash text inside a word', () => {
    expect(findAgentQuickPanelTrigger('path/to', 7)).toBeNull()
  })
})

describe('filterAgentQuickPanelItems', () => {
  it('returns all items when the query is empty', () => {
    expect(filterAgentQuickPanelItems(items, '').map((item) => item.id)).toEqual(['compact', 'context', 'workspace'])
  })

  it('prefers prefix matches before secondary matches', () => {
    expect(filterAgentQuickPanelItems(items, 'co').map((item) => item.id)).toEqual(['compact', 'context'])
  })

  it('matches description and keyword text', () => {
    expect(filterAgentQuickPanelItems(items, 'folder').map((item) => item.id)).toEqual(['workspace'])
  })

  it('keeps always-visible items at the top while filtering normal items', () => {
    expect(
      filterAgentQuickPanelItems(
        [
          {
            id: 'clear',
            label: 'Clear all',
            description: 'Clear selected models',
            group: 'actions',
            alwaysVisible: true
          },
          ...items
        ],
        'zzz'
      ).map((item) => item.id)
    ).toEqual(['clear'])
  })
})

describe('getNextAgentQuickPanelIndex', () => {
  it('wraps forward through the list', () => {
    expect(getNextAgentQuickPanelIndex(2, 1, 3)).toBe(0)
  })

  it('wraps backward through the list', () => {
    expect(getNextAgentQuickPanelIndex(0, -1, 3)).toBe(2)
  })

  it('returns -1 when the list is empty', () => {
    expect(getNextAgentQuickPanelIndex(0, 1, 0)).toBe(-1)
  })
})

describe('quick panel state helpers', () => {
  it('prefers button-open manual mode over input trigger mode', () => {
    expect(
      resolveAgentQuickPanelMode(
        { symbol: '/', start: 0, end: 2, query: 'c' },
        { mode: '@', query: 'cla' }
      )
    ).toBe('@')
  })

  it('uses the manual search query when the panel was opened from a button', () => {
    expect(
      resolveAgentQuickPanelQuery(
        { symbol: '/', start: 0, end: 2, query: 'co' },
        { mode: '/', query: 'tod' }
      )
    ).toBe('tod')
  })

  it('keeps the mention panel open after selecting a model item', () => {
    expect(shouldKeepAgentQuickPanelOpenAfterSelection('@', 'mention:anthropic:claude-sonnet-4')).toBe(true)
  })

  it('closes the slash panel after normal actions', () => {
    expect(shouldKeepAgentQuickPanelOpenAfterSelection('/', 'action:tools')).toBe(false)
  })

  it('toggles the same manual panel closed when its toolbar button is clicked again', () => {
    expect(shouldCloseAgentQuickPanelFromButton(true, '@', '@')).toBe(true)
  })

  it('switches panels instead of closing when a different toolbar button is clicked', () => {
    expect(shouldCloseAgentQuickPanelFromButton(true, '/', '@')).toBe(false)
  })

  it('dismisses the open panel from a global Escape key', () => {
    expect(shouldDismissAgentQuickPanelFromKey(true, 'Escape')).toBe(true)
  })

  it('keeps the panel open for non-dismiss keys and when already closed', () => {
    expect(shouldDismissAgentQuickPanelFromKey(true, 'Enter')).toBe(false)
    expect(shouldDismissAgentQuickPanelFromKey(false, 'Escape')).toBe(false)
  })

  it('dismisses the open panel when pointer target is outside the inputbar', () => {
    expect(shouldDismissAgentQuickPanelFromOutsidePointer(true, false)).toBe(true)
  })

  it('keeps the panel open for inputbar pointer targets and when already closed', () => {
    expect(shouldDismissAgentQuickPanelFromOutsidePointer(true, true)).toBe(false)
    expect(shouldDismissAgentQuickPanelFromOutsidePointer(false, false)).toBe(false)
  })
})
