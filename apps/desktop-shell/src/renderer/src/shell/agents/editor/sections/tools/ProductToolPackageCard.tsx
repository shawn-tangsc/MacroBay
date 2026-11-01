import { Select } from 'antd'
import { ChevronDown, Package } from 'lucide-react'
import { useState } from 'react'

import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'
import type { LocalizedText } from '@platform/product-manifest'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import type { AgentText } from '../../../agentText'

type ProductToolPackagePermissionMode = ProductAgentToolPackageEditorView['permissionMode']
type ProductTool = ProductAgentToolPackageEditorView['tools'][number]

/** 未搜索时先露 8 行；30 个工具一次铺开会把下面的字段全挤到抽屉外。 */
const VISIBLE_TOOL_LIMIT = 8

export function ProductToolPackageCard({
  text,
  language,
  package: pkg,
  productName,
  tools,
  filtered,
  onPermissionChange
}: {
  text: AgentText
  language: AppLanguage
  package: ProductAgentToolPackageEditorView
  productName?: LocalizedText
  tools: ProductAgentToolPackageEditorView['tools']
  /** 搜索收窄过：此时全部命中工具都要露出来，不折叠。 */
  filtered: boolean
  onPermissionChange: (permissionMode: ProductToolPackagePermissionMode) => void
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const displayName = productName?.[language]
  const readOnlyCount = pkg.tools.filter((tool) => tool.readOnly).length
  const asOfCount = pkg.tools.filter((tool) => tool.requiresTemporalBoundary).length
  const showAll = filtered || expanded
  const visibleTools = showAll ? tools : tools.slice(0, VISIBLE_TOOL_LIMIT)
  const collapsible = !filtered && pkg.tools.length > VISIBLE_TOOL_LIMIT

  return (
    <article className="agent-product-package">
      <header className="agent-product-package-head">
        <span className="agent-product-package-icon">
          <Package size={15} aria-hidden="true" />
        </span>
        <div className="agent-product-package-identity">
          <div className="agent-product-package-name">
            <strong title={displayName ?? pkg.productId}>{displayName ?? pkg.productId}</strong>
            <span className={`agent-product-status ${pkg.status}`}>{statusLabel(text, pkg.status)}</span>
            {pkg.staleBinding ? (
              <span className="agent-product-status stale">{text.editor.tools.staleProductToolBinding}</span>
            ) : null}
          </div>
          {displayName ? <div className="agent-product-package-id">{pkg.productId}</div> : null}
        </div>
        <div className="agent-product-permission">
          <span>{text.editor.tools.productToolPermissionLabel}</span>
          <Select<ProductToolPackagePermissionMode>
            size="small"
            aria-label={text.editor.tools.productToolPermissionLabel}
            value={pkg.permissionMode}
            options={[
              { value: 'disabled', label: text.editor.tools.productToolPermissionDisabled },
              { value: 'allow-read-only', label: text.editor.tools.productToolPermissionAllowReadOnly },
              { value: 'prompt', label: text.editor.tools.productToolPermissionPrompt }
            ]}
            onChange={onPermissionChange}
          />
        </div>
      </header>

      <p className="agent-product-summary">
        {text.editor.tools.productToolSummary(
          pkg.tools.length,
          readOnlyCount,
          pkg.tools.length - readOnlyCount,
          asOfCount
        )}
      </p>

      {pkg.permissionMode === 'disabled' ? (
        <p className="agent-product-note">{text.editor.tools.productToolDisabledNote}</p>
      ) : null}

      {pkg.diagnostics.length > 0 ? (
        <p className="agent-product-diagnostics">{pkg.diagnostics.join(' ')}</p>
      ) : null}

      <table className="agent-product-tools">
        <thead>
          <tr>
            <th scope="col">{text.editor.tools.productToolColumnTool}</th>
            <th scope="col">{text.editor.tools.productToolColumnType}</th>
            <th scope="col">{text.editor.tools.productToolColumnAsOf}</th>
          </tr>
        </thead>
        <tbody>
          {visibleTools.map((tool) => (
            <tr key={tool.toolName}>
              <td>
                <div className="agent-product-tool-name">
                  <span>{tool.title?.[language] ?? tool.toolName}</span>
                  {tool.schemaVersion > 1 ? (
                    <span className="agent-product-tool-version">v{tool.schemaVersion}</span>
                  ) : null}
                </div>
                {tool.title?.[language] && tool.title[language] !== tool.toolName ? (
                  <div className="agent-product-tool-id">{tool.toolName}</div>
                ) : null}
              </td>
              <td>
                <ToolKindBadge text={text} tool={tool} />
              </td>
              <td>
                {tool.requiresTemporalBoundary ? (
                  <span className="agent-product-tool-asof">asOf</span>
                ) : (
                  <span className="agent-product-tool-empty">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {collapsible ? (
        <button
          type="button"
          className="agent-product-tools-more"
          aria-expanded={showAll}
          onClick={() => setExpanded((current) => !current)}>
          {showAll ? text.editor.tools.productToolCollapse : text.editor.tools.productToolExpand(pkg.tools.length)}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      ) : null}
    </article>
  )
}

function ToolKindBadge({ text, tool }: { text: AgentText; tool: ProductTool }): React.ReactElement {
  return tool.readOnly ? (
    <span className="agent-product-tool-readonly">{text.editor.tools.readOnlyBadge}</span>
  ) : (
    <span className="agent-product-tool-writable">{text.editor.tools.writableBadge}</span>
  )
}

function statusLabel(text: AgentText, status: ProductAgentToolPackageEditorView['status']): string {
  switch (status) {
    case 'available':
      return text.editor.tools.productToolStatusAvailable
    case 'missing-handler':
      return text.editor.tools.productToolStatusMissingHandler
    default:
      return text.editor.tools.productToolStatusNotInstalled
  }
}
