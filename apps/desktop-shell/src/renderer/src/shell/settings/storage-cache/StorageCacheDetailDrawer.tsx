import { Button, Drawer } from 'antd'
import { RotateCw } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { CacheOperationAuditRecord, SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import {
  dedupeWarnings,
  formatAbsoluteTime,
  formatBackupPolicy,
  formatBytes,
  formatCategory,
  formatDurability,
  formatKind,
  formatOwner,
  formatRelativeTime,
  formatSensitivity,
  type StorageCacheLabels
} from './storageCacheDisplay'
import { StorageCacheOperationList } from './StorageCacheOperationList'
import { resolveStorageCacheText, resolveStorageCacheWarnings } from './storageCacheViewModel'

type StorageCacheDetailDrawerProps = {
  cache: SafeCacheView | null
  caches: SafeCacheView[]
  records: CacheOperationAuditRecord[]
  language: AppLanguage
  labels: StorageCacheLabels
  dryRun: boolean
  onClose: () => void
  onRecheck: (cache: SafeCacheView) => void
  onClear: (cache: SafeCacheView) => void
  onCompact: (cache: SafeCacheView) => void
}

export function StorageCacheDetailDrawer({
  cache,
  caches,
  records,
  language,
  labels,
  dryRun,
  onClose,
  onRecheck,
  onClear,
  onCompact
}: StorageCacheDetailDrawerProps): React.ReactElement {
  const name = cache ? resolveStorageCacheText(cache.displayName, cache.displayNameI18n, language) : ''
  const description = cache ? resolveStorageCacheText(cache.description, cache.descriptionI18n, language) : ''
  const warnings = cache ? dedupeWarnings(resolveStorageCacheWarnings(cache, language)) : []
  const inspection = cache?.latestInspection

  return (
    <Drawer
      className="storage-cache-drawer"
      width="min(460px, 46vw)"
      placement="right"
      open={Boolean(cache)}
      onClose={onClose}
      title={name}
      footer={
        cache ? (
          <div className="drawer-actions drawer-actions-split">
            <span className="storage-cache-muted">{dryRun ? labels.dryRunHint : null}</span>
            <div className="storage-cache-drawer-actions">
              <Button
                className="ant-secondary-button"
                icon={<RotateCw size={14} />}
                onClick={() => onRecheck(cache)}>
                {labels.recheck}
              </Button>
              {cache.clearable ? (
                <Button className="ant-secondary-button" onClick={() => onClear(cache)}>
                  {labels.clear}
                </Button>
              ) : null}
              {cache.compactable ? (
                <Button className="ant-secondary-button" onClick={() => onCompact(cache)}>
                  {labels.compact}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null
      }>
      {cache ? (
        <div className="storage-cache-drawer-body">
          <p className="storage-cache-drawer-caption">
            {formatOwner(cache, labels)} · {formatCategory(cache.category, labels)}
          </p>
          <p className="storage-cache-drawer-description">{description}</p>

          <dl className="storage-cache-stats">
            <div>
              <dt>{labels.fieldSize}</dt>
              <dd>{formatBytes(inspection?.sizeBytes, labels.emptyValue)}</dd>
            </div>
            <div>
              <dt>{labels.fieldRecordCount}</dt>
              <dd>{inspection?.recordCount ?? labels.emptyValue}</dd>
            </div>
            <div>
              <dt>{labels.fieldLastUpdated}</dt>
              <dd title={formatAbsoluteTime(inspection?.lastUpdatedAt, language)}>
                {inspection?.lastUpdatedAt
                  ? formatRelativeTime(inspection.lastUpdatedAt, language)
                  : labels.emptyValue}
              </dd>
            </div>
          </dl>

          <dl className="storage-cache-attrs">
            <div>
              <dt>{labels.fieldKind}</dt>
              <dd>{formatKind(cache.cacheKind, labels)}</dd>
            </div>
            <div>
              <dt>{labels.fieldDurability}</dt>
              <dd>{formatDurability(cache.durability, labels)}</dd>
            </div>
            <div>
              <dt>{labels.fieldBackupPolicy}</dt>
              <dd>{formatBackupPolicy(cache.backupPolicy, labels)}</dd>
            </div>
            <div>
              <dt>{labels.fieldSensitivity}</dt>
              <dd>{formatSensitivity(cache.sensitivity, labels)}</dd>
            </div>
          </dl>

          {warnings.length > 0 ? (
            <section className="storage-cache-notice" aria-label={labels.fieldWarnings}>
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          ) : null}

          <section className="storage-cache-drawer-history">
            <h3>{labels.historyTitle}</h3>
            <StorageCacheOperationList
              language={language}
              labels={labels}
              records={records}
              caches={caches}
              emptyLabel={labels.historyEmpty}
            />
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
