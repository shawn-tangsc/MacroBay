import { describe, expect, it } from 'vitest'

import { pickFlowLabelIndexes, placeFlowLabels, type FlowLabelAnchor, type FlowLabelGeometry } from './capitalFlowLabels'
import type { FlowChartRow } from './capitalFlowRows'

const row = (tradingDate: string, funds: number, btc = 0, eth = 0): FlowChartRow => ({ tradingDate, funds, btc, eth })

const geometry: FlowLabelGeometry = {
  chartWidth: 420,
  chartHeight: 108,
  labelHeight: 14,
  gap: 2,
  inset: 4,
  maxLanes: 3,
  // The date ticks get their own band; labels must stop above it.
  axisBand: 22
}

function boxOf(boxes: readonly { left: number; top: number }[], width: number) {
  return boxes.map((box) => ({ left: box.left, top: box.top, right: box.left + width, bottom: box.top + geometry.labelHeight }))
}

function overlaps(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number }
): boolean {
  return left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom
}

describe('pickFlowLabelIndexes', () => {
  it('labels the largest inflow, the largest outflow and the last day', () => {
    const rows = [row('d1', 10), row('d2', -50), row('d3', 90), row('d4', 20)]
    expect(pickFlowLabelIndexes(rows)).toEqual([1, 2, 3])
  })

  it('labels one number when the last day is also the largest inflow', () => {
    const rows = [row('d1', -30), row('d2', 10), row('d3', 99)]
    expect(pickFlowLabelIndexes(rows)).toEqual([0, 2])
  })

  it('measures only the stablecoin series, never BTC or ETH', () => {
    const rows = [row('d1', 5, -900), row('d2', 6, 800), row('d3', 7, 700)]
    expect(pickFlowLabelIndexes(rows)).toEqual([2])
  })

  it('drops the role it cannot fill instead of labelling a zero', () => {
    expect(pickFlowLabelIndexes([row('d1', 4), row('d2', 8)])).toEqual([1])
    expect(pickFlowLabelIndexes([row('d1', -4), row('d2', -8)])).toEqual([1])
    expect(pickFlowLabelIndexes([])).toEqual([])
  })

  it('keeps the earliest day when two days tie', () => {
    expect(pickFlowLabelIndexes([row('d1', 10), row('d2', 10), row('d3', 1)])).toEqual([0, 2])
  })

  it('selects by row index, not by the formatted string', () => {
    const rows = [row('d1', 1), row('d2', 2), row('d3', 3)]
    const indexes = pickFlowLabelIndexes(rows)
    expect(new Set(indexes).size).toBe(indexes.length)
  })
})

describe('placeFlowLabels', () => {
  it('never lets two neighbouring labels overlap', () => {
    const anchors: FlowLabelAnchor[] = [
      { index: 1, centerX: 100, anchorY: 52, direction: 'inflow', width: 60 },
      { index: 2, centerX: 108, anchorY: 40, direction: 'inflow', width: 60 },
      { index: 3, centerX: 116, anchorY: 46, direction: 'inflow', width: 60 }
    ]
    const boxes = placeFlowLabels(anchors, geometry)
    const rects = boxOf(boxes, 60)
    for (let index = 0; index < rects.length; index += 1) {
      for (let other = index + 1; other < rects.length; other += 1) {
        expect(overlaps(rects[index]!, rects[other]!)).toBe(false)
      }
    }
  })

  it('follows each value end: above an inflow top, below an outflow tip', () => {
    const anchors: FlowLabelAnchor[] = [
      { index: 1, centerX: 200, anchorY: 30, direction: 'inflow', width: 60 },
      { index: 2, centerX: 120, anchorY: 60, direction: 'outflow', width: 60 }
    ]
    const boxes = placeFlowLabels(anchors, geometry)
    const inflow = boxes.find((box) => box.index === 1)!
    const outflow = boxes.find((box) => box.index === 2)!
    expect(inflow.top + geometry.labelHeight).toBeLessThanOrEqual(30 - geometry.gap)
    expect(outflow.top).toBeGreaterThanOrEqual(60 + geometry.gap)
  })

  it('pushes a bar-tip label up to the band edge instead of entering the band', () => {
    const boxes = placeFlowLabels([{ index: 0, centerX: 200, anchorY: 108, direction: 'outflow', width: 60 }], geometry)
    expect(boxes[0]!.top + geometry.labelHeight).toBeLessThanOrEqual(108 - 22 - 2)
  })

  it('clamps a label inside a narrow chart', () => {
    const narrow = { ...geometry, chartWidth: 100 }
    const boxes = placeFlowLabels([{ index: 0, centerX: 6, anchorY: 40, direction: 'inflow', width: 80 }], narrow)
    expect(boxes[0]?.left).toBe(narrow.inset)
  })

  it('answers every anchor, even when the frame cannot separate them', () => {
    const crowded: FlowLabelAnchor[] = [1, 2, 3].map((index) => ({
      index, centerX: 40, anchorY: 54, direction: 'inflow' as const, width: 60
    }))
    const small = { ...geometry, labelHeight: 40, maxLanes: 1 }
    const boxes = placeFlowLabels(crowded, small)
    expect(boxes.map((box) => box.index)).toEqual([1, 2, 3])
  })
})
