import { X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { AgentAttachedFile } from '../agentMessageInput'

/**
 * 只有一个读屏名，句子由调用方以已解析的字符串传入（`AgentText` 是对象，不是键表）。
 *
 * `resolveText` 拿到的仍然是**键**：这个函数按键返回句子，而不是把句子直接喂给组件——
 * 零参闭包会让「只收键」这条约定形同虚设。
 */
const REMOVE_ATTACHMENT_KEY = 'agent.attachments.remove'

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

  // 按键返回句子：`IconButton` 传进来的是键，不是已经解析好的文案。
  const resolveAriaLabel = (key: string): string => (key === REMOVE_ATTACHMENT_KEY ? removeLabel : key)

  return (
    <div className="agent-attachment-strip">
      {files.map((file) => (
        <span key={file.path} title={file.error ?? file.path}>
          {file.error ? `${file.name} · ${readFailedLabel}` : file.truncated ? `${file.name} · ${truncatedLabel}` : file.name}
          <IconButton
            ariaLabelKey={REMOVE_ATTACHMENT_KEY}
            icon={X}
            size="sm"
            onSelect={() => onRemove(file.path)}
            resolveText={resolveAriaLabel}
          />
        </span>
      ))}
    </div>
  )
}
