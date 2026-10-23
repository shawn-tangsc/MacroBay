import type { AgentMessageFileArtifact } from './agentMessageFileArtifacts'

export const agentMessageFileOpenTargetIds = [
  'vscode',
  'cursor',
  'default',
  'terminal',
  'iterm2',
  'xcode',
  'android-studio',
  'intellij-idea',
  'pycharm',
  'finder'
] as const

export type AgentMessageFileOpenTargetId = (typeof agentMessageFileOpenTargetIds)[number]

type AgentMessageFileArtifactOpener = {
  openFileWithApp: (request: { targetId: AgentMessageFileOpenTargetId; filePath: string }) => Promise<unknown>
}

export async function openAgentMessageFileArtifact(
  file: AgentMessageFileArtifact,
  targetId: AgentMessageFileOpenTargetId,
  opener: AgentMessageFileArtifactOpener = window.platform.app
): Promise<boolean> {
  if (!file.absolutePath.trim()) return false
  await opener.openFileWithApp({
    targetId,
    filePath: file.absolutePath
  })
  return true
}
