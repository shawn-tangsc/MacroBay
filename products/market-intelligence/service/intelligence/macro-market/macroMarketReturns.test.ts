import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { macroMarketBackfillBars, macroMarketHistoryIsThin, macroMarketLongestWindowMs } from './macroMarketReturns'
import { createMacroMarketStore, type MacroMarketStore } from './macroMarketStore'

const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs
const at = (offsetMinutes: number) => Date.UTC(2026, 9, 14, 12, 0) + offsetMinutes * minuteMs

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function store(): MacroMarketStore {
  const directory = mkdtempSync(join(tmpdir(), 'macro-market-returns-'))
  directories.push(directory)
  return createMacroMarketStore(join(directory, 'macro-market.sqlite'))
}

it('sizes the backfill from the longest window the wire admits', () => {
  // The contract owns the window ladder, so the collector asks its own arithmetic how many bars a
  // week is instead of holding a second opinion. A hundred bars was a day, and a day is not a week.
  expect(macroMarketLongestWindowMs()).toBe(7 * dayMs)
  expect(macroMarketBackfillBars(15 * minuteMs)).toBe(672)
  expect(macroMarketBackfillBars(5 * minuteMs)).toBe(2016)
})

it('calls a history thin until it can answer the longest window', () => {
  const target = store()
  expect(macroMarketHistoryIsThin(target, 'xau-usd'), 'no points at all is thin').toBe(true)
  target.append([{ series: 'xau-usd', atMs: at(0), value: 1, observedAtMs: at(0) }])
  expect(macroMarketHistoryIsThin(target, 'xau-usd'), 'one point spans nothing').toBe(true)
  target.append([{ series: 'xau-usd', atMs: at(0) + 3 * dayMs, value: 2, observedAtMs: at(0) }])
  expect(macroMarketHistoryIsThin(target, 'xau-usd'), 'three days cannot anchor a seven-day window').toBe(true)
  target.append([{ series: 'xau-usd', atMs: at(0) + 7 * dayMs, value: 3, observedAtMs: at(0) }])
  expect(macroMarketHistoryIsThin(target, 'xau-usd'), 'a stored week answers it').toBe(false)
  target.close()
})

it('measures that window in time, not in points, for a market that closes', () => {
  // Five trading days hold far fewer fifteen-minute bars than seven calendar days do. Counting points
  // would call this history thin forever and turn every tick into a backfill that changes nothing.
  const target = store()
  const start = at(0)
  target.append(Array.from({ length: 480 }, (_, index) => ({
    series: 'xau-usd', atMs: start + index * 15 * minuteMs, value: 1 + index, observedAtMs: start
  })))
  expect(macroMarketHistoryIsThin(target, 'xau-usd')).toBe(false)
  target.close()
})
