import { X } from 'lucide-react'

import type { AgentAttachedFile } from '../agentMessageInput'

type AgentAttachmentStripProps = {
  files: readonly AgentAttachedFile[]
  readFailedLabel: string
  truncatedLabel: string
  removeLabel: string
  onRemove: (path: string) => void
}

export default function AgentAttachmentStrip({
  files,
  readFailedLabel,
  truncatedLabel,
  removeLabel,
  onRemove
}: AgentAttachmentStripProps): React.ReactElement | null {
  if (files.length === 0) return null

  return (
    <div className="agent-attachment-strip">
      {files.map((file) => (
        <span key={file.path} title={file.error ?? file.path}>
          {file.error ? `${file.name} · ${readFailedLabel}` : file.truncated ? `${file.name} · ${truncatedLabel}` : file.name}
          <button type="button" aria-label={removeLabel} onClick={() => onRemove(file.path)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}
