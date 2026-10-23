import type { AgentRuntimeMessagePartDetailItem } from './agentRuntimeMessageParts'

type AgentRuntimeMessagePartItemOpener = {
  openExternal: (target: string) => Promise<unknown>
  openPath: (target: string) => Promise<unknown>
}

export async function openAgentRuntimeMessagePartDetailItem(
  item: AgentRuntimeMessagePartDetailItem,
  opener: AgentRuntimeMessagePartItemOpener = window.platform.app
): Promise<boolean> {
  if (!item.openTarget || !item.openTargetKind) return false

  if (item.openTargetKind === 'path') {
    await opener.openPath(item.openTarget)
    return true
  }

  await opener.openExternal(item.openTarget)
  return true
}
