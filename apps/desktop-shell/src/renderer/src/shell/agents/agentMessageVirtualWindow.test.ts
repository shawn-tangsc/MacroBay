import { describe, expect, it } from 'vitest'

import {
  buildAgentMessageVirtualWindow,
  estimateAgentMessageVirtualOffset,
  shouldVirtualizeAgentMessageList,
  type AgentMessageVirtualItem
} from './agentMessageVirtualWindow'

function item(id: string, messageCount = 1): AgentMessageVirtualItem {
  return {
    id,
    messageCount
  }
}

describe('agent message virtual window', () => {
  it('returns the full list when virtualization is disabled', () => {
    const items = [item('group-1'), item('group-2'), item('group-3')]

    expect(
      buildAgentMessageVirtualWindow({
        items,
        viewportHeight: 800,
        scrollTop: 0,
        measuredHeightsById: {},
        enabled: false
      })
    ).toEqual({
      startIndex: 0,
      endIndex: 2,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 456,
      items
    })
  })

  it('builds a padded visible range with overscan for long lists', () => {
    const items = Array.from({ length: 8 }, (_, index) => item(`group-${index + 1}`))

    expect(
      buildAgentMessageVirtualWindow({
        items,
        viewportHeight: 240,
        scrollTop: 480,
        measuredHeightsById: {},
        overscanPx: 120
      })
    ).toEqual({
      startIndex: 2,
      endIndex: 5,
      paddingTop: 304,
      paddingBottom: 304,
      totalHeight: 1216,
      items: items.slice(2, 6)
    })
  })

  it('prefers measured heights when available', () => {
    const items = [item('group-1'), item('group-2', 2), item('group-3')]

    expect(
      buildAgentMessageVirtualWindow({
        items,
        viewportHeight: 160,
        scrollTop: 180,
        measuredHeightsById: {
          'group-1': 90,
          'group-2': 300,
          'group-3': 110
        },
        overscanPx: 0
      })
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      paddingTop: 90,
      paddingBottom: 110,
      totalHeight: 500,
      items: [items[1]]
    })
  })

  it('falls back to item estimated heights before generic constants', () => {
    const items = [
      { ...item('group-1'), estimatedHeight: 100 },
      { ...item('group-2'), estimatedHeight: 260 },
      { ...item('group-3'), estimatedHeight: 140 }
    ]

    expect(
      buildAgentMessageVirtualWindow({
        items,
        viewportHeight: 180,
        scrollTop: 120,
        measuredHeightsById: {},
        overscanPx: 0
      })
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      paddingTop: 100,
      paddingBottom: 140,
      totalHeight: 500,
      items: [items[1]]
    })
  })

  it('keeps one group mounted before the viewport height is measured', () => {
    const items = Array.from({ length: 8 }, (_, index) => item(`group-${index + 1}`))

    expect(
      buildAgentMessageVirtualWindow({
        items,
        viewportHeight: 0,
        scrollTop: 304,
        measuredHeightsById: {},
        overscanPx: 0
      })
    ).toEqual({
      startIndex: 2,
      endIndex: 2,
      paddingTop: 304,
      paddingBottom: 760,
      totalHeight: 1216,
      items: [items[2]]
    })
  })

  it('estimates the scroll offset for a target index', () => {
    const items = [item('group-1'), item('group-2', 2), item('group-3')]

    expect(
      estimateAgentMessageVirtualOffset({
        items,
        targetIndex: 2,
        measuredHeightsById: {
          'group-1': 100,
          'group-2': 260
        }
      })
    ).toBe(360)
  })

  it('enables virtualization only after the threshold is crossed', () => {
    expect(shouldVirtualizeAgentMessageList(23)).toBe(false)
    expect(shouldVirtualizeAgentMessageList(24)).toBe(true)
  })
})
