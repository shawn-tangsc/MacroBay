const NEAR_BOTTOM_THRESHOLD_PX = 48

export function isNearBottom(input: {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  thresholdPx?: number
}): boolean {
  const threshold = input.thresholdPx ?? NEAR_BOTTOM_THRESHOLD_PX
  return input.scrollHeight - (input.scrollTop + input.clientHeight) <= threshold
}

export function getScrollTopAfterPrepend(input: {
  previousScrollTop: number
  previousScrollHeight: number
  nextScrollHeight: number
}): number {
  return input.previousScrollTop + (input.nextScrollHeight - input.previousScrollHeight)
}
