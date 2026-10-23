import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { ChannelIncomingAttachment } from '../../ai/agent-platform/channels'

export async function persistChannelAttachments(input: {
  sessionId: string
  workspacePath: string
  attachments: ChannelIncomingAttachment[]
}): Promise<{
  savedFiles: Array<{
    kind: 'image' | 'file'
    originalName: string
    savedPath: string
  }>
}> {
  const normalizedWorkspacePath = resolve(input.workspacePath)
  const savedFiles: Array<{
    kind: 'image' | 'file'
    originalName: string
    savedPath: string
  }> = []

  for (const attachment of input.attachments) {
    const directoryName = attachment.kind === 'image' ? 'channel-images' : 'channel-files'
    const targetDir = join(normalizedWorkspacePath, '.agent-workspace', directoryName)
    await mkdir(targetDir, { recursive: true })

    const safeName = sanitizeAttachmentFileName(attachment.name, attachment.kind === 'image' ? 'attachment.png' : 'attachment.bin')
    const filename =
      attachment.kind === 'image'
        ? `${Date.now()}-${randomUUID().slice(0, 8)}${ensureImageSuffix(safeName, attachment.mimeType)}`
        : `${Date.now()}-${safeName}`
    const savedPath = join(targetDir, filename)
    await writeFile(savedPath, Buffer.from(attachment.data, 'base64'))
    savedFiles.push({
      kind: attachment.kind,
      originalName: attachment.name,
      savedPath
    })
  }

  return { savedFiles }
}

function sanitizeAttachmentFileName(name: string, fallback: string): string {
  const trimmed = name.trim()
  const safeName = trimmed.replace(/[/\\:*?"<>|]/g, '_')
  return safeName || fallback
}

function ensureImageSuffix(name: string, mimeType: string): string {
  if (/\.[A-Za-z0-9]+$/.test(name)) {
    return name.startsWith('.') ? name : `-${name}`
  }

  const subtype = mimeType.split('/')[1]?.trim().toLowerCase()
  const normalizedSubtype = subtype === 'jpeg' ? 'jpg' : subtype
  const suffix = normalizedSubtype ? `.${normalizedSubtype}` : '.png'
  return `-${name}${suffix}`
}
