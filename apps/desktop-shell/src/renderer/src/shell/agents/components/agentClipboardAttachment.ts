import type { AgentAttachedFile } from '../agentMessageInput'
import { readAgentAttachedFile } from '../agentInputbarAttachments'

/** Clipboard pixels have no path; persist them through the platform temp-file bridge first. */
export async function readClipboardImageAttachment(
  file: File,
  allowImageAttachments: boolean
): Promise<AgentAttachedFile> {
  const data = new Uint8Array(await file.arrayBuffer())
  const path = await window.platform.app.saveClipboardImage(data, file.type)
  return readAgentAttachedFile(path, allowImageAttachments)
}
