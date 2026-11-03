import type { FlowChartRow } from './capitalFlowRows'

/**
 * The chart labels three readings, not twenty-one: the largest inflow, the largest outflow
 * (both measured on the stablecoin series only — BTC and ETH stay unlabelled) and the last day
 * in the window. Two roles landing on the same day produce one label, not two stacked numbers.
 *
 * Selection is by row index, so two days that happen to format to the same string (`+$0.0M`)
 * are still two different days.
 */
export function pickFlowLabelIndexes(rows: readonly FlowChartRow[]): readonly number[] {
  if (rows.length === 0) return []
  const selected = new Set<number>()
  let inflowIndex = -1
  let inflowValue = Number.NEGATIVE_INFINITY
  let outflowIndex = -1
  let outflowValue = Number.POSITIVE_INFINITY
  for (let index = 0; index < rows.length; index += 1) {
    const value = rows[index]!.funds
    if (value > 0 && value > inflowValue) { inflowIndex = index; inflowValue = value }
    if (value < 0 && value < outflowValue) { outflowIndex = index; outflowValue = value }
  }
  if (inflowIndex >= 0) selected.add(inflowIndex)
  if (outflowIndex >= 0) selected.add(outflowIndex)
  selected.add(rows.length - 1)
  return [...selected].sort((left, right) => left - right)
}

export type FlowLabelDirection = 'inflow' | 'outflow' | 'zero'

/** Where the label wants to sit, measured from the bar it belongs to (all values in pixels). */
export type FlowLabelAnchor = {
  index: number
  /** Hub of the bar, used to centre the label. */
  centerX: number
  /**
   * The bar edge the label sits above. Always the bar's top: for an inflow that is the tip, for
   * an outflow it is the edge at the zero line — so an outflow label rises into the empty upper
   * half instead of dropping towards the date axis below the chart.
   */
  anchorY: number
  direction: FlowLabelDirection
  /** Measured text box width; decided by the rendered text, not by a fixed offset. */
  width: number
}

export type FlowLabelBox = { index: number; left: number; top: number }

/** Clearance kept between a label box and the reserved date band. */
export const AXIS_BAND_MARGIN = 2

export type FlowLabelGeometry = {
  chartWidth: number
  chartHeight: number
  labelHeight: number
  /** Space kept between the bar and its label. */
  gap: number
  /** Space kept between a label and the chart frame. */
  inset: number
  /** Height at the bottom of the plot reserved for the date ticks: no label may enter it. */
  axisBand: number
  /** How many extra heights a label may climb before it gives up and stays put. */
  maxLanes: number
}

/**
 * Places the label boxes so that two readings never overlap and none covers a bar.
 *
 * Two neighbouring short bars are the hard case: their labels start at nearly the same height,
 * a few pixels apart, so a fixed horizontal offset puts one text over the other. The label
 * therefore climbs (inflow) or drops (outflow) one lane at a time until its box is clear, and
 * every box is clamped inside the chart frame.
 */
export function placeFlowLabels(
  anchors: readonly FlowLabelAnchor[],
  geometry: FlowLabelGeometry
): readonly FlowLabelBox[] {
  const placed: { left: number; top: number; right: number; bottom: number }[] = []
  const boxes: FlowLabelBox[] = []
  const ordered = [...anchors].sort((left, right) => left.centerX - right.centerX)
  const lowestTop = geometry.inset
  // The bottom band belongs to the date ticks. Labels are clamped above it with a 2px margin.
  const highestTop = Math.max(
    geometry.inset,
    geometry.chartHeight - geometry.axisBand - AXIS_BAND_MARGIN - geometry.labelHeight - geometry.inset
  )
  for (const anchor of ordered) {
    const left = clamp(
      anchor.centerX - anchor.width / 2,
      geometry.inset,
      Math.max(geometry.inset, geometry.chartWidth - anchor.width - geometry.inset)
    )
    // Every label rises. A label that dropped below an outflow bar would land on the date axis.
    const baseTop = clamp(anchor.anchorY - geometry.labelHeight - geometry.gap, lowestTop, highestTop)
    const rectOf = (top: number) => ({ left, top, right: left + anchor.width, bottom: top + geometry.labelHeight })
    const free = (top: number) => !placed.some((box) => intersects(box, rectOf(top)))
    let top = baseTop
    let chosen = rectOf(top)
    // Whole lane steps first, so several labels line up instead of scattering by a pixel.
    for (let lane = 0; lane <= geometry.maxLanes; lane += 1) {
      const candidate = clamp(baseTop - (geometry.labelHeight + geometry.gap) * lane, lowestTop, highestTop)
      chosen = rectOf(candidate)
      if (free(candidate)) { top = candidate; break }
    }
    if (!free(top)) {
      // The frame is too short for whole lanes: walk one pixel at a time so the boxes still
      // never overlap while there is any free row left.
      for (let candidate = baseTop; candidate >= lowestTop; candidate -= 1) {
        if (free(candidate)) { top = candidate; break }
      }
      chosen = rectOf(top)
    }
    placed.push(chosen)
    boxes.push({ index: anchor.index, left: Math.round(chosen.left), top: Math.round(chosen.top) })
  }
  return boxes.sort((left, right) => left.index - right.index)
}

function intersects(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number }
): boolean {
  return left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
