import { describe, expect, it } from 'vitest'

import { resolveBriefingMode, type DailyBriefingMode, type DailyBriefingRowState } from './dailyBriefingMode'

/**
 * §4.13's table, one assertion per cell: the row's state x the pane's state. Written as a table so a
 * regression names the cell it broke. The three cells the reader hit in real life are called out in
 * their own tests below; this one is the exhaustive grid.
 */
type ViewStatus = 'loading' | 'no-edition' | 'ready' | 'unavailable' | 'locale-missing'

const VIEW_STATUSES: readonly ViewStatus[] = ['loading', 'no-edition', 'ready', 'unavailable', 'locale-missing']
const ROW_STATES: readonly DailyBriefingRowState[] = ['idle', 'running', 'failed', 'published']

function expected(rowState: DailyBriefingRowState, viewStatus: ViewStatus, hasEdition: boolean, localeAvailable: boolean): DailyBriefingMode {
  if (rowState === 'running' || viewStatus === 'loading') return 'generating'
  if (viewStatus === 'ready') return rowState === 'failed' ? 'ready-with-failure' : 'ready'
  if (rowState === 'failed' || viewStatus === 'unavailable') return 'failed'
  if (hasEdition && !localeAvailable) return 'locale-missing'
  return 'no-edition'
}

const cells = ROW_STATES.flatMap((rowState) => VIEW_STATUSES.map((viewStatus) => {
  const hasEdition = rowState === 'published' || rowState === 'failed'
  const localeAvailable = viewStatus !== 'locale-missing'
  return { rowState, viewStatus, hasEdition, localeAvailable, mode: expected(rowState, viewStatus, hasEdition, localeAvailable) }
}))

describe('one page state, one answer', () => {
  it('covers every cell of the table', () => {
    expect(cells).toHaveLength(20)
  })

  it.each(cells)('$rowState + $viewStatus -> $mode', ({ rowState, viewStatus, hasEdition, localeAvailable, mode }) => {
    expect(resolveBriefingMode({ rowState, viewStatus, hasEdition, localeAvailable })).toBe(mode)
  })

  it('running + no-edition -> generating (a scheduled run owns the pane)', () => {
    expect(resolveBriefingMode({ rowState: 'running', viewStatus: 'no-edition', hasEdition: false, localeAvailable: true })).toBe('generating')
  })

  it('idle + missing language -> locale-missing, not "no edition"', () => {
    expect(resolveBriefingMode({ rowState: 'idle', viewStatus: 'locale-missing', hasEdition: true, localeAvailable: false })).toBe('locale-missing')
  })

  it('hasEdition + retry failed -> ready-with-failure', () => {
    expect(resolveBriefingMode({ rowState: 'failed', viewStatus: 'ready', hasEdition: true, localeAvailable: true })).toBe('ready-with-failure')
  })
})
