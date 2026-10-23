import { CheckCircle2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, Button, Checkbox, Drawer } from 'antd'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import type { ModelSyncPreview } from '@platform/ai/providers/providerModelSync'

import type { ProviderModelSyncSelection } from './model-service/modelSyncPlan'

export type { ProviderModelSyncSelection } from './model-service/modelSyncPlan'

type ProviderModelSyncLabels = {
  title: string
  added: string
  missing: string
  /** PLAT-63 C：第三组「本地多余（预设已变更）」。 */
  localSurplus: string
  localSurplusHint: string
  upToDate: string
  upToDateHint: string
  removedHint: string
  selectAll: string
  deselectAll: string
  cancel: string
  apply: string
  addSummary: (selected: number, total: number) => string
  removeSummary: (selected: number, total: number) => string
}

type ProviderModelSyncDrawerProps = {
  open: boolean
  preview: ModelSyncPreview | null
  selection: ProviderModelSyncSelection
  isApplying: boolean
  labels: ProviderModelSyncLabels
  onClose: () => void
  onApply: () => void
  onToggleAdded: (modelId: string) => void
  onToggleMissing: (modelId: string) => void
  onToggleStale: (modelId: string) => void
  onToggleAllAdded: () => void
  onToggleAllMissing: () => void
  onToggleAllStale: () => void
}

export function ProviderModelSyncDrawer({
  open,
  preview,
  selection,
  isApplying,
  labels,
  onClose,
  onApply,
  onToggleAdded,
  onToggleMissing,
  onToggleStale,
  onToggleAllAdded,
  onToggleAllMissing,
  onToggleAllStale
}: ProviderModelSyncDrawerProps): React.ReactElement {
  const added = preview?.added ?? []
  const missing = preview?.missing ?? []
  const stale = preview?.stale ?? []
  const hasAdded = added.length > 0
  const hasMissing = missing.length > 0
  const hasStale = stale.length > 0
  const totalSelected = selection.addedIds.size + selection.missingIds.size + selection.staleIds.size

  return (
    <Drawer
      className="model-drawer model-sync-drawer"
      title={labels.title}
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      footer={
        <div className="model-sync-footer">
          <div className="model-sync-summary">
            {hasAdded ? (
              <span>
                <Plus size={13} />
                {labels.addSummary(selection.addedIds.size, added.length)}
              </span>
            ) : null}
            {hasMissing ? (
              <span>
                <Trash2 size={13} />
                {labels.removeSummary(selection.missingIds.size, missing.length)}
              </span>
            ) : null}
            {hasStale ? (
              <span data-model-sync-stale-summary>
                <Trash2 size={13} />
                {labels.removeSummary(selection.staleIds.size, stale.length)}
              </span>
            ) : null}
          </div>
          <div className="drawer-actions drawer-actions-split">
            <Button className="ant-secondary-button" disabled={isApplying} onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button
              className="ant-primary-button"
              icon={<RefreshCw size={14} />}
              loading={isApplying}
              disabled={isApplying || totalSelected === 0}
              onClick={onApply}>
              {labels.apply}
            </Button>
          </div>
        </div>
      }>
      {!hasAdded && !hasMissing && !hasStale ? (
        <div className="model-sync-empty">
          <CheckCircle2 size={28} />
          <strong>{labels.upToDate}</strong>
          <span>{labels.upToDateHint}</span>
        </div>
      ) : (
        <div className="model-sync-content">
          {hasAdded ? (
            <section className="model-sync-section" data-model-sync-group="added">
              <div className="model-sync-section-header">
                <span>{labels.added} ({added.length})</span>
                <Button type="text" size="small" onClick={onToggleAllAdded}>
                  {selection.addedIds.size === added.length ? labels.deselectAll : labels.selectAll}
                </Button>
              </div>
              <div className="model-sync-list">
                {added.map((model) => (
                  <ModelSyncRow
                    key={model.id}
                    model={model}
                    checked={selection.addedIds.has(model.id)}
                    type="added"
                    disabled={isApplying}
                    onToggle={() => onToggleAdded(model.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {hasMissing ? (
            <section className="model-sync-section" data-model-sync-group="missing">
              <div className="model-sync-section-header">
                <span>{labels.missing} ({missing.length})</span>
                <Button type="text" size="small" onClick={onToggleAllMissing}>
                  {selection.missingIds.size === missing.length ? labels.deselectAll : labels.selectAll}
                </Button>
              </div>
              <Alert className="model-sync-warning" type="warning" showIcon message={labels.removedHint} />
              <div className="model-sync-list">
                {missing.map((item) => (
                  <ModelSyncRow
                    key={item.model.id}
                    model={item.model}
                    checked={selection.missingIds.has(item.model.id)}
                    type="missing"
                    disabled={isApplying}
                    onToggle={() => onToggleMissing(item.model.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {hasStale ? (
            <section className="model-sync-section" data-model-sync-group="stale">
              <div className="model-sync-section-header">
                <span>{labels.localSurplus} ({stale.length})</span>
                <Button type="text" size="small" onClick={onToggleAllStale}>
                  {selection.staleIds.size === stale.length ? labels.deselectAll : labels.selectAll}
                </Button>
              </div>
              <Alert className="model-sync-warning" type="warning" showIcon message={labels.localSurplusHint} />
              <div className="model-sync-list">
                {stale.map((model) => (
                  <ModelSyncRow
                    key={model.id}
                    model={model}
                    checked={selection.staleIds.has(model.id)}
                    type="stale"
                    disabled={isApplying}
                    onToggle={() => onToggleStale(model.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  )
}

function ModelSyncRow({
  model,
  checked,
  type,
  disabled,
  onToggle
}: {
  model: ModelDefinition
  checked: boolean
  type: 'added' | 'missing' | 'stale'
  disabled: boolean
  onToggle: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`model-sync-row ${type}`}
      data-model-sync-row={model.id}
      data-model-sync-type={type}
      disabled={disabled}
      onClick={onToggle}>
      <Checkbox checked={checked} disabled={disabled} />
      <span className="model-sync-avatar">{model.name.slice(0, 1).toUpperCase()}</span>
      <span className="model-sync-row-main">
        <strong>{model.name}</strong>
        <small>{model.id}</small>
      </span>
      <span className="model-sync-row-tags">
        {model.capabilities.chat ? <small>Chat</small> : null}
        {model.capabilities.embedding ? <small>Embedding</small> : null}
        {model.capabilities.vision ? <small>Vision</small> : null}
        {model.capabilities.tools ? <small>Tools</small> : null}
      </span>
    </button>
  )
}
