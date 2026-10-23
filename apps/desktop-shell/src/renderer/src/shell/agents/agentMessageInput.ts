export type AgentAttachedFile = {
  path: string
  name: string
  kind?: 'text' | 'document' | 'image' | 'unsupported'
  text?: string
  truncated?: boolean
  error?: string
}

export function buildAgentMessageText(text: string, files: readonly AgentAttachedFile[]): string {
  const trimmedText = text.trim()
  if (files.length === 0) return trimmedText

  const attachmentText = files.map(formatAttachedFile).join('\n\n')
  return trimmedText ? `${trimmedText}\n\nAttached files:\n${attachmentText}` : `Attached files:\n${attachmentText}`
}

function formatAttachedFile(file: AgentAttachedFile): string {
  const header = `File: ${file.name}\nPath: ${file.path}`
  if (file.error) return `${header}\nRead error: ${file.error}`
  if (file.kind === 'image' || file.kind === 'document') {
    return `${header}\nContent: [${file.kind} attachment]`
  }

  const content = file.text?.trimEnd() ?? ''
  const suffix = file.truncated ? '\n[Content truncated to the first 128 KB.]' : ''
  return `${header}\nContent:\n${content}${suffix}`
}
