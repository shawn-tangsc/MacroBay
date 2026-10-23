const ASSISTANT_MESSAGE_NEAR_BOTTOM_THRESHOLD_PX = 48

export type AssistantMessageListScrollMetrics = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export type AssistantMessageListStickinessState = {
  shouldStickToBottom: boolean
}

export function isAssistantMessageListNearBottom(
  input: AssistantMessageListScrollMetrics,
  thresholdPx = ASSISTANT_MESSAGE_NEAR_BOTTOM_THRESHOLD_PX
): boolean {
  return input.scrollHeight - (input.scrollTop + input.clientHeight) <= thresholdPx
}

export function updateAssistantMessageListStickiness(
  input: AssistantMessageListScrollMetrics,
  state: AssistantMessageListStickinessState
): void {
  state.shouldStickToBottom = isAssistantMessageListNearBottom(input)
}

export function scrollAssistantMessageListAfterRender(
  input: AssistantMessageListScrollMetrics,
  state: AssistantMessageListStickinessState
): void {
  if (!state.shouldStickToBottom) return
  input.scrollTop = Math.max(0, input.scrollHeight - input.clientHeight)
}
