import { Select, Tag } from 'antd'
import { Package } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'

import type { AgentText } from '../../../agentText'
import { EmptyCatalog } from './EmptyCatalog'

type ProductToolPackagePermissionMode = ProductAgentToolPackageEditorView['permissionMode']

type ProductToolPackagesCatalogProps = {
  text: AgentText
  agentId: string
  search: string
}

export function ProductToolPackagesCatalog({
  text,
  agentId,
  search
}: ProductToolPackagesCatalogProps): React.ReactElement {
  const [packages, setPackages] = useState<ProductAgentToolPackageEditorView[]>([])

  useEffect(() => {
    if (!agentId) {
      setPackages([])
      return
    }

    let cancelled = false
    void window.platform.agents.productTools.listPackages(agentId).then((rows) => {
      if (cancelled) return
      setPackages((rows as ProductAgentToolPackageEditorView[]) ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [agentId])

  const filtered = packages.filter((pkg) => {
    const haystack = [pkg.productId, ...pkg.tools.map((tool) => tool.toolName), ...pkg.diagnostics].join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  })

  if (filtered.length === 0) {
    return (
      <EmptyCatalog
        icon={<Package size={17} />}
        title={text.editor.tools.noProductToolPackagesTitle}
        description={text.editor.tools.noProductToolPackagesDescription}
      />
    )
  }

  return (
    <div className="agent-tool-catalog compact">
      {filtered.map((pkg) => (
        <article key={pkg.productId} className="agent-tool-row">
          <header className="agent-tool-row-header">
            <div>
              <strong>{pkg.productId}</strong>
              <div className="agent-tool-row-meta">
                <Tag color={pkg.status === 'available' ? 'green' : 'default'}>{pkg.status}</Tag>
                {pkg.staleBinding ? <Tag color="orange">{text.editor.tools.staleProductToolBinding}</Tag> : null}
              </div>
            </div>
            <Select<ProductToolPackagePermissionMode>
              size="small"
              value={pkg.permissionMode}
              options={[
                { value: 'disabled', label: text.editor.tools.productToolPermissionDisabled },
                { value: 'allow-read-only', label: text.editor.tools.productToolPermissionAllowReadOnly },
                { value: 'prompt', label: text.editor.tools.productToolPermissionPrompt }
              ]}
              onChange={(permissionMode) => {
                void window.platform.agents.productTools.updatePackageBinding(agentId, pkg.productId, permissionMode)
              }}
            />
          </header>
          {pkg.diagnostics.length > 0 ? (
            <p className="agent-tool-row-description">{pkg.diagnostics.join(' ')}</p>
          ) : null}
          <ul className="agent-tool-row-tools">
            {pkg.tools.map((tool) => (
              <li key={tool.toolName}>
                <span>{tool.toolName}</span>
                <Tag>{text.editor.tools.readOnlyBadge}</Tag>
                {tool.requiresTemporalBoundary ? <Tag>{text.editor.tools.requiresAsOfBadge}</Tag> : null}
                <Tag>v{tool.schemaVersion}</Tag>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}
