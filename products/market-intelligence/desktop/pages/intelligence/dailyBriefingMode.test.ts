import { describe, expect, it } from 'vitest'

import { resolveBriefingMode, type DailyBriefingMode, type DailyBriefingRowState } from './dailyBriefingMode'

/**
 * §4.13, transcribed by hand: one literal row per cell of the table.
 *
 * The expectations are written out, not computed. An earlier version derived them from a copy of the
 * rules inside this file, which stayed green when the implementation and the copy were wrong in the
 * same way — a self-checking test that proved nothing. If a cell here is wrong, it must be wrong
 * against §4.13, and the only way to know is to have written it down.
 */
type ViewStatus = 'loading' | 'no-edition' | 'ready' | 'unavailable' | 'locale-missing'

type Cell = Readonly<{
  rowState: DailyBriefingRowState
  viewStatus: ViewStatus
  hasEdition: boolean
  localeAvailable: boolean
  mode: DailyBriefingMode
}>

const cells: readonly Cell[] = [
  // idle: nothing published for this issue.
  { rowState: 'idle', viewStatus: 'loading', hasEdition: false, localeAvailable: true, mode: 'generating' },
  { rowState: 'idle', viewStatus: 'no-edition', hasEdition: false, localeAvailable: true, mode: 'no-edition' },
  { rowState: 'idle', viewStatus: 'ready', hasEdition: false, localeAvailable: true, mode: 'ready' },
  { rowState: 'idle', viewStatus: 'unavailable', hasEdition: false, localeAvailable: true, mode: 'failed' },
  // The reader's own issue: an edition exists, just not in the language asked for.
  { rowState: 'idle', viewStatus: 'locale-missing', hasEdition: true, localeAvailable: false, mode: 'locale-missing' },

  // running: a run in flight owns the pane, whoever started it.
  { rowState: 'running', viewStatus: 'loading', hasEdition: false, localeAvailable: true, mode: 'generating' },
  { rowState: 'running', viewStatus: 'no-edition', hasEdition: false, localeAvailable: true, mode: 'generating' },
  { rowState: 'running', viewStatus: 'ready', hasEdition: true, localeAvailable: true, mode: 'generating' },
  { rowState: 'running', viewStatus: 'unavailable', hasEdition: false, localeAvailable: true, mode: 'generating' },
  { rowState: 'running', viewStatus: 'locale-missing', hasEdition: true, localeAvailable: false, mode: 'generating' },

  // failed: the row says the attempt failed; an edition on screen still wins.
  { rowState: 'failed', viewStatus: 'loading', hasEdition: false, localeAvailable: true, mode: 'generating' },
  { rowState: 'failed', viewStatus: 'no-edition', hasEdition: false, localeAvailable: true, mode: 'failed' },
  { rowState: 'failed', viewStatus: 'ready', hasEdition: true, localeAvailable: true, mode: 'ready-with-failure' },
  { rowState: 'failed', viewStatus: 'unavailable', hasEdition: false, localeAvailable: true, mode: 'failed' },
  { rowState: 'failed', viewStatus: 'locale-missing', hasEdition: true, localeAvailable: false, mode: 'failed' },

  // published: an edition exists for this issue.
  { rowState: 'published', viewStatus: 'loading', hasEdition: true, localeAvailable: true, mode: 'generating' },
  { rowState: 'published', viewStatus: 'no-edition', hasEdition: true, localeAvailable: false, mode: 'locale-missing' },
  { rowState: 'published', viewStatus: 'ready', hasEdition: true, localeAvailable: true, mode: 'ready' },
  { rowState: 'published', viewStatus: 'unavailable', hasEdition: true, localeAvailable: true, mode: 'failed' },
  { rowState: 'published', viewStatus: 'locale-missing', hasEdition: true, localeAvailable: false, mode: 'locale-missing' }
]

describe('one page state, one answer', () => {
  it('transcribes the whole table', () => {
    expect(cells).toHaveLength(20)
  })

  it.each(cells)('$rowState + $viewStatus -> $mode', ({ rowState, viewStatus, hasEdition, localeAvailable, mode }) => {
    expect(resolveBriefingMode({ rowState, viewStatus, hasEdition, localeAvailable })).toBe(mode)
  })
})
