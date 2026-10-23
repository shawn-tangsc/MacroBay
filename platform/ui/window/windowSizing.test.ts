import { describe, expect, it } from 'vitest'

import {
  clampWindowSizeToMinimum,
  DEFAULT_MIN_WINDOW_HEIGHT,
  DEFAULT_MIN_WINDOW_WIDTH,
  getAgentPageMinimumSize,
  SECONDARY_MIN_WINDOW_WIDTH
} from './windowSizing'

describe('windowSizing', () => {
  it('uses the full desktop minimum size when the agent sidebar is visible', () => {
    expect(getAgentPageMinimumSize(true)).toEqual({
      width: DEFAULT_MIN_WINDOW_WIDTH,
      height: DEFAULT_MIN_WINDOW_HEIGHT
    })
  })

  it('uses the compact width when the agent sidebar is hidden', () => {
    expect(getAgentPageMinimumSize(false)).toEqual({
      width: SECONDARY_MIN_WINDOW_WIDTH,
      height: DEFAULT_MIN_WINDOW_HEIGHT
    })
  })

  it('clamps undersized window dimensions back to the minimum size', () => {
    expect(
      clampWindowSizeToMinimum(
        [420, 540],
        {
          width: DEFAULT_MIN_WINDOW_WIDTH,
          height: DEFAULT_MIN_WINDOW_HEIGHT
        }
      )
    ).toEqual([DEFAULT_MIN_WINDOW_WIDTH, DEFAULT_MIN_WINDOW_HEIGHT])
  })

  it('preserves larger dimensions when they are already above the minimum', () => {
    expect(
      clampWindowSizeToMinimum(
        [1280, 900],
        {
          width: DEFAULT_MIN_WINDOW_WIDTH,
          height: DEFAULT_MIN_WINDOW_HEIGHT
        }
      )
    ).toEqual([1280, 900])
  })
})
