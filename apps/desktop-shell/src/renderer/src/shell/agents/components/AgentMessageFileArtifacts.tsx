import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { ChevronDown, Code2, File, FileText, FolderSearch, TerminalSquare } from 'lucide-react'
import { useState } from 'react'

import type { AgentMessageFileArtifact, AgentMessageFileArtifactSummary } from '../agentMessageFileArtifacts'
import {
  agentMessageFileOpenTargetIds,
  openAgentMessageFileArtifact,
  type AgentMessageFileOpenTargetId
} from '../agentMessageFileArtifactOpen'

type AgentMessageFileArtifactsProps = {
  summary: AgentMessageFileArtifactSummary
  text: {
    editedSummary: (count: number) => string
    touchedSummary: (count: number) => string
    changedStats: (added: number, removed: number) => string
    showMore: (count: number) => string
    showLess: string
    documentKind: string
    codeKind: string
    fileKind: string
    openWith: string
    openWithAria: (fileName: string) => string
    targets: Record<AgentMessageFileOpenTargetId, string>
  }
}

const DEFAULT_VISIBLE_FILE_COUNT = 3

export default function AgentMessageFileArtifacts({
  summary,
  text
}: AgentMessageFileArtifactsProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  if (summary.totalCount === 0) return null

  const visibleFiles = expanded ? summary.files : summary.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT)
  const hiddenCount = Math.max(0, summary.files.length - visibleFiles.length)
  const changedCount = summary.editedCount + summary.generatedCount
  const summaryTitle =
    changedCount > 0 ? text.editedSummary(changedCount) : text.touchedSummary(summary.totalCount)

  return (
    <section className="agent-message-file-artifacts">
      <article className="agent-message-file-summary-card">
        <header>
          <span className="agent-message-file-summary-icon">
            <FileText size={17} />
          </span>
          <div className="agent-message-file-summary-heading">
            <strong>{summaryTitle}</strong>
            {typeof summary.addedLines === 'number' && typeof summary.removedLines === 'number' ? (
              <small>{text.changedStats(summary.addedLines, summary.removedLines)}</small>
            ) : null}
          </div>
        </header>
        <div className="agent-message-file-summary-list">
          {summary.files.slice(0, expanded ? summary.files.length : DEFAULT_VISIBLE_FILE_COUNT).map((file) => (
            <div key={file.id}>
              <span title={file.absolutePath}>{file.displayPath}</span>
            </div>
          ))}
        </div>
        {summary.files.length > DEFAULT_VISIBLE_FILE_COUNT ? (
          <button
            type="button"
            className="agent-message-file-show-more"
            onClick={() => setExpanded((current) => !current)}>
            {expanded ? text.showLess : text.showMore(hiddenCount)}
            <ChevronDown size={13} />
          </button>
        ) : null}
      </article>
      <article className="agent-message-file-list-card">
        {visibleFiles.map((file) => (
          <FileArtifactRow key={file.id} file={file} text={text} />
        ))}
      </article>
    </section>
  )
}

function FileArtifactRow({
  file,
  text
}: {
  file: AgentMessageFileArtifact
  text: AgentMessageFileArtifactsProps['text']
}): React.ReactElement {
  const menuItems: MenuProps['items'] = [
    ...agentMessageFileOpenTargetIds
      .filter((targetId) => targetId !== 'finder')
      .map((targetId) => ({
        key: targetId,
        label: text.targets[targetId],
        icon: renderTargetIcon(targetId),
        onClick: () => {
          void openAgentMessageFileArtifact(file, targetId)
        }
      })),
    { type: 'divider' as const },
    {
      key: 'finder',
      label: text.targets.finder,
      icon: renderTargetIcon('finder'),
      onClick: () => {
        void openAgentMessageFileArtifact(file, 'finder')
      }
    }
  ]

  return (
    <div className="agent-message-file-row">
      <span className="agent-message-file-icon">{renderFileIcon(file.kind)}</span>
      <div className="agent-message-file-info">
        <strong title={file.absolutePath}>{file.fileName}</strong>
        <small>{buildFileMeta(file, text)}</small>
      </div>
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <Button
          className="agent-message-file-open-with"
          size="small"
          aria-label={text.openWithAria(file.fileName)}>
          {text.openWith}
          <ChevronDown size={13} />
        </Button>
      </Dropdown>
    </div>
  )
}

function buildFileMeta(file: AgentMessageFileArtifact, text: AgentMessageFileArtifactsProps['text']): string {
  const kind = file.kind === 'document' ? text.documentKind : file.kind === 'code' ? text.codeKind : text.fileKind
  return file.extension ? `${kind} · ${file.extension}` : kind
}

function renderFileIcon(kind: AgentMessageFileArtifact['kind']): React.ReactElement {
  if (kind === 'code') return <Code2 size={18} />
  if (kind === 'document') return <FileText size={18} />
  return <File size={18} />
}

function renderTargetIcon(targetId: AgentMessageFileOpenTargetId): React.ReactElement {
  if (targetId === 'terminal' || targetId === 'iterm2') return <TerminalSquare size={14} />
  if (targetId === 'finder') return <FolderSearch size={14} />
  if (targetId === 'default') return <File size={14} />
  return <Code2 size={14} />
}
