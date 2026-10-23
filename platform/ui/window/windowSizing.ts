export const DEFAULT_MIN_WINDOW_WIDTH = 960
export const SECONDARY_MIN_WINDOW_WIDTH = 520
export const DEFAULT_MIN_WINDOW_HEIGHT = 600

export type MinimumWindowSize = {
  width: number
  height: number
}

export function getAgentPageMinimumSize(showSidebar: boolean): MinimumWindowSize {
  return {
    width: showSidebar ? DEFAULT_MIN_WINDOW_WIDTH : SECONDARY_MIN_WINDOW_WIDTH,
    height: DEFAULT_MIN_WINDOW_HEIGHT
  }
}

export function clampWindowSizeToMinimum(
  currentSize: readonly [number, number],
  minimumSize: MinimumWindowSize
): [number, number] {
  return [
    Math.max(currentSize[0], minimumSize.width),
    Math.max(currentSize[1], minimumSize.height)
  ]
}
