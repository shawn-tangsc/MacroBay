export function canSubmitAgentInput(input: { draft: string; fileCount: number }): boolean {
  return input.draft.trim().length > 0 || input.fileCount > 0
}

export function shouldShowStopControl(activeRunId: string | null): boolean {
  return Boolean(activeRunId)
}

export function getAgentTextareaMaxHeight(expanded: boolean): number {
  return expanded ? 420 : 180
}

export function toggleAgentInputExpanded(current: boolean, nextState?: boolean): boolean {
  return typeof nextState === 'boolean' ? nextState : !current
}
