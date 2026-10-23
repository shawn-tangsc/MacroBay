import { classifyAgentAttachment } from './agentAttachmentPolicy'
import type { AgentAttachedFile } from './agentMessageInput'

export async function readAgentAttachedFile(
  path: string,
  allowImageAttachments: boolean
): Promise<AgentAttachedFile> {
  const name = path.split(/[\\/]/).pop() || path
  const kind = classifyAgentAttachment(path, allowImageAttachments)

  if (kind === 'unsupported') {
    return {
      path,
      name,
      kind,
      error: 'Unsupported attachment type for the current model.'
    }
  }

  if (kind === 'image' || kind === 'document') {
    return {
      path,
      name,
      kind
    }
  }

  try {
    const result = (await window.platform.app.readTextFile(path)) as { path: string; text: string; truncated: boolean }
    return {
      path: result.path,
      name,
      kind,
      text: result.text,
      truncated: result.truncated
    }
  } catch (error) {
    return {
      path,
      name,
      kind,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
