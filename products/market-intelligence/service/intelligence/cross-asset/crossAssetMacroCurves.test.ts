import { describe, expect, it } from 'vitest'

import { crossAssetMacroCurvePolicy, crossAssetMacroCurves } from './crossAssetMacroCurves'

const minute = 60_000
const hour = 3_600_000
const start = Date.UTC(2026, 9, 8, 0, 0)
const at = (offsetMs: number) => start + offsetMs

/** A series of closes `stepMs` apart, `count` of them, newest last, ending at `endMs`. */
function series(stepMs: number, count: number, endMs: number, value: (index: number) => number) {
  return Array.from({ length: count }, (_, index) => ({
    atMs: endMs - (count - 1 - index) * stepMs, value: value(index)
  }))
}

const candidates = (dxy: readonly unknown[], gold: readonly unknown[] = []) => ({
  dxy: dxy as never, gold: gold as never
})

describe('the macro curves drawn beside the crypto rows', () => {
  it('anchors every line on the same window start, reading the last close at or before each instant', () => {
    // Five-minute closes for the first quarter hour, then four-hourly ones: the shape a series has once
    // the deep pages have delivered it, and the shape an exact-bar rule could not draw a line through.
    const points = [
      { atMs: start, value: 100 }, { atMs: at(5 * minute), value: 101 }, { atMs: at(10 * minute), value: 102 },
      { atMs: at(15 * minute), value: 103 },
      { atMs: at(2 * hour), value: 110 }, { atMs: at(3 * hour), value: 111 }, { atMs: at(4 * hour), value: 112 }
    ]
    const curves = crossAssetMacroCurves({
      candidates: candidates([{ seriesId: 'dxy-real', points }]),
      windowStartMs: start, count: 5, strideMs: hour
    })

    expect(curves.dxy.map(point => point.atMs)).toEqual([start, at(hour), at(2 * hour), at(3 * hour), at(4 * hour)])
    // Every point is a return against the window's own first close, never against a later bar.
    for (const [index, expected] of [0, 3, 10, 11, 12].entries()) {
      expect(curves.dxy[index]!.returnPercent).toBeCloseTo(expected, 6)
    }
    // The hourly instant with no bar of its own still has a price: the last close before it, and no
    // further back than a day.
    expect(curves.dxy[1]!.returnPercent).toBeCloseTo(3, 6)
  })

  it('prefers the licensed dollar and falls back to the basket only when it cannot anchor the window', () => {
    const real = series(5 * minute, 3, at(-6 * hour), () => 100)
    const synthetic = series(15 * minute, 300, at(hour), index => 100 + index)
    const withReal = crossAssetMacroCurves({
      candidates: candidates([{ seriesId: 'dxy-real', points: real }, { seriesId: 'dxy-synthetic', points: synthetic }]),
      windowStartMs: start, count: 3, strideMs: hour
    })
    expect(withReal.dxy.every(point => point.returnPercent === 0)).toBe(true)

    // A real series that stopped a week ago is too stale to anchor, so the labelled basket answers.
    const stale = series(5 * minute, 3, at(-7 * 24 * hour), () => 100)
    const withFallback = crossAssetMacroCurves({
      candidates: candidates([{ seriesId: 'dxy-real', points: stale }, { seriesId: 'dxy-synthetic', points: synthetic }]),
      windowStartMs: start, count: 3, strideMs: hour
    })
    expect(withFallback.dxy.some(point => point.returnPercent !== null)).toBe(true)
    expect(withFallback.dxy[withFallback.dxy.length - 1]!.returnPercent).not.toBe(0)
  })

  it('draws nothing rather than anchoring inside the window', () => {
    // The series only begins after the window opened: no base exists, so there is no same-anchor line.
    const late = series(5 * minute, 10, at(2 * hour), () => 100)
    expect(crossAssetMacroCurves({ candidates: candidates([{ seriesId: 'xau-usd', points: late }]), windowStartMs: start, count: 5, strideMs: hour }).dxy)
      .toEqual([])
    expect(crossAssetMacroCurves({ candidates: candidates([], [{ seriesId: 'xau-usd', points: late }]), windowStartMs: start, count: 5, strideMs: hour }).gold)
      .toEqual([])
  })

  it('stops carrying a close once the gap is longer than a day, so a closed market is a gap and not a line', () => {
    // The dollar's weekend: Friday's closes, then nothing until Monday, and the window opens on Sunday.
    const friday = series(4 * hour, 3, at(-2 * 24 * hour), index => 100 + index)
    const monday = series(4 * hour, 3, at(2 * 24 * hour), index => 110 + index)
    const curves = crossAssetMacroCurves({
      candidates: candidates([{ seriesId: 'dxy-real', points: [...friday, ...monday] }]),
      windowStartMs: start, count: 13, strideMs: 4 * hour
    })

    // Sunday carries no price: the last close is more than a day old, and inventing one is what the cap
    // exists to prevent. The base is still Friday's close — that is what anchoring on this window needs.
    expect(curves.dxy.slice(0, 10).every(point => point.returnPercent === null)).toBe(true)
    // Monday's first bar resumes the line, against that same Friday base; the anchor is the last Friday
    // close, so the return is measured from it and not from the window's edge.
    expect(curves.dxy[10]!.returnPercent).toBeCloseTo(100 * (110 / 102 - 1), 6)
    expect(crossAssetMacroCurvePolicy.maxCarryMs).toBe(24 * hour)
    expect(crossAssetMacroCurvePolicy.anchorLookbackMs).toBe(3 * 24 * hour)
  })
})
