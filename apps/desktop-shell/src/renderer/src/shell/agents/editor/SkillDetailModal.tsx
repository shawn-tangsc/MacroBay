import { useEffect, useMemo, useState } from 'react'
import { Modal, Tag } from 'antd'
import { ChevronRight, FileText, Folder, Sparkles } from 'lucide-react'

import type { InstalledSkill, SkillFileNode } from '@platform/ai/agent-platform/schemas/skillSchemas'
import type { AgentSkillRuntimeCatalogEntry } from '@platform/ai/agent-platform/skills/skillRuntimeSchemas'

import type { useAgentText } from '../agentTextProvider'
import { buildAgentSkillRuntimeViewModel } from './agentSkillRuntimeViewModel'
import {
  findFirstSkillPreviewFile,
  flattenSkillFileTree,
  guessSkillFileLanguage,
  isSkillMarkdownFile
} from './skillFileTreeViewModel'

type SkillDetailModalProps = {
  open: boolean
  text: ReturnType<typeof useAgentText>
  skill: InstalledSkill | null
  runtimeEntry: AgentSkillRuntimeCatalogEntry | null
  onClose: () => void
}

export default function SkillDetailModal({
  open,
  text,
  skill,
  runtimeEntry,
  onClose
}: SkillDetailModalProps): React.ReactElement {
  const [fileTree, setFileTree] = useState<SkillFileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const flatFiles = useMemo(() => flattenSkillFileTree(fileTree), [fileTree])
  const runtimeView = useMemo(() => buildAgentSkillRuntimeViewModel(runtimeEntry), [runtimeEntry])

  useEffect(() => {
    if (!open || !skill) return
    let cancelled = false
    setLoadingTree(true)
    setError(null)
    setFileContent(null)

    void window.platform.agents.skills
      .listFiles(skill.id)
      .then((nodes) => {
        if (cancelled) return
        const nextTree = nodes as SkillFileNode[]
        setFileTree(nextTree)
        setSelectedFile(findFirstSkillPreviewFile(nextTree))
      })
      .catch((treeError) => {
        if (cancelled) return
        setFileTree([])
        setSelectedFile(null)
        setError(errorMessage(treeError))
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, skill])

  useEffect(() => {
    if (!open || !skill || !selectedFile) {
      setFileContent(null)
      return
    }
    let cancelled = false
    setLoadingContent(true)
    setError(null)

    void window.platform.agents.skills
      .readFile(skill.id, selectedFile)
      .then((content) => {
        if (cancelled) return
        setFileContent((content as string | null) ?? null)
      })
      .catch((contentError) => {
        if (cancelled) return
        setFileContent(null)
        setError(errorMessage(contentError))
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedFile, skill])

  return (
    <Modal open={open} width={860} footer={null} title={skill?.name ?? text.editor.tools.skillDetailTitle} onCancel={onClose}>
      {skill ? (
        <div className="agent-skill-detail">
          <header className="agent-skill-detail-header">
            <span className="agent-tool-icon">
              <Sparkles size={15} />
            </span>
            <span className="agent-tool-copy">
              <strong>{skill.name}</strong>
              <small>{skill.description ?? text.common.noDescription}</small>
              <span className="agent-marketplace-meta">
                <Tag className="agent-tool-approval">{skill.source}</Tag>
                {skill.author ? <span>{skill.author}</span> : null}
                {skill.sourceTags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </span>
            </span>
          </header>

          {error ? <div className="agent-skill-marketplace-error">{error}</div> : null}

          <section className="agent-skill-runtime-grid">
            <div className="agent-skill-runtime-card">
              <div className="agent-tool-list-heading">{text.editor.tools.skillRuntimeTools}</div>
              {runtimeView.runtimeTools.length === 0 ? (
                <p className="agent-empty-copy">{text.editor.tools.noSkillRuntimeTools}</p>
              ) : (
                <div className="agent-skill-runtime-list">
                  {runtimeView.runtimeTools.map((tool) => (
                    <div key={tool.toolId} className="agent-skill-runtime-row">
                      <strong>{tool.toolName}</strong>
                      <Tag className="agent-tool-approval">{tool.toolId}</Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="agent-skill-runtime-card">
              <div className="agent-tool-list-heading">{text.editor.tools.skillRuntimeCapabilities}</div>
              {runtimeView.capabilities.length === 0 ? (
                <p className="agent-empty-copy">{text.editor.tools.noSkillRuntimeCapabilities}</p>
              ) : (
                <div className="agent-skill-runtime-list">
                  {runtimeView.capabilities.map((capability) => (
                    <div key={capability.capabilityId} className="agent-skill-capability-card">
                      <div className="agent-skill-runtime-row">
                        <strong>{capability.title}</strong>
                        <Tag className="agent-tool-approval">{capability.entryFile ?? capability.kind}</Tag>
                      </div>
                      {capability.summary ? <p>{capability.summary}</p> : null}
                      {capability.bodyPreview ? (
                        <pre className="agent-skill-capability-preview">{capability.bodyPreview}</pre>
                      ) : null}
                      <span className="agent-marketplace-meta">
                        {capability.sourcePath ? <span>{capability.sourcePath}</span> : null}
                        {capability.bodyPreviewTruncated ? <span>{text.editor.tools.skillBodyPreviewTruncated}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="agent-skill-detail-body">
            <aside className="agent-skill-file-tree">
              <div className="agent-tool-list-heading">{text.editor.tools.skillFiles}</div>
              {loadingTree ? (
                <p className="agent-empty-copy">{text.editor.tools.loadingSkillFiles}</p>
              ) : flatFiles.length === 0 ? (
                <p className="agent-empty-copy">{text.editor.tools.noSkillFiles}</p>
              ) : (
                flatFiles.map((node) => (
                  <button
                    key={node.path}
                    type="button"
                    className={selectedFile === node.path ? 'agent-skill-file-row active' : 'agent-skill-file-row'}
                    style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                    disabled={node.type === 'directory'}
                    onClick={() => {
                      if (node.type === 'file') setSelectedFile(node.path)
                    }}>
                    {node.type === 'directory' ? <ChevronRight size={12} /> : <FileText size={12} />}
                    {node.type === 'directory' ? <Folder size={12} /> : null}
                    <span>{node.name}</span>
                  </button>
                ))
              )}
            </aside>

            <section className="agent-skill-file-preview">
              <div className="agent-skill-preview-title">
                <strong>{selectedFile ?? text.editor.tools.selectSkillFile}</strong>
                {selectedFile ? <Tag className="agent-tool-approval">{guessSkillFileLanguage(selectedFile)}</Tag> : null}
              </div>
              {loadingContent ? (
                <p className="agent-empty-copy">{text.editor.tools.loadingSkillFile}</p>
              ) : fileContent ? (
                isSkillMarkdownFile(selectedFile ?? '') ? (
                  <pre className="agent-skill-markdown-preview">{fileContent}</pre>
                ) : (
                  <pre className="agent-skill-code-preview">{fileContent}</pre>
                )
              ) : (
                <div className="agent-empty-catalog compact">
                  <FileText size={17} />
                  <strong>{text.editor.tools.selectSkillFile}</strong>
                  <span>{text.editor.tools.selectSkillFileDescription}</span>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error')
}
