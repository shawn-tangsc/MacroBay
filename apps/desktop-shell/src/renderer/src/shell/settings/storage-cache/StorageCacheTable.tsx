import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import {
  formatAbsoluteTime,
  formatBytes,
  formatCategory,
  formatInspectionStatus,
  formatOwner,
  formatRelativeTime,
  formatSensitivity,
  type StorageCacheLabels
} from './storageCacheDisplay'
import { resolveStorageCacheText } from './storageCacheViewModel'

type StorageCacheTableProps = {
  language: AppLanguage
  labels: StorageCacheLabels
  caches: SafeCacheView[]
  onOpen: (cacheId: string) => void
  onClear: (cache: SafeCacheView) => void
  onCompact: (cache: SafeCacheView) => void
}

export function StorageCacheTable({
  language,
  labels,
  caches,
  onOpen,
  onClear,
  onCompact
}: StorageCacheTableProps): React.ReactElement {
  return (
    <table className="storage-cache-table">
      <colgroup>
        <col />
        <col className="storage-cache-col-size" />
        <col className="storage-cache-col-count" />
        <col className="storage-cache-col-status" />
        <col className="storage-cache-col-updated" />
        <col className="storage-cache-col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{labels.columnName}</th>
          <th scope="col" className="storage-cache-align-end">{labels.columnSize}</th>
          <th scope="col" className="storage-cache-align-end">{labels.columnRecords}</th>
          <th scope="col">{labels.columnStatus}</th>
          <th scope="col">{labels.columnUpdated}</th>
          <th scope="col" className="storage-cache-align-end">{labels.columnActions}</th>
        </tr>
      </thead>
      <tbody>
        {caches.map((cache) => {
          const inspection = cache.latestInspection
          return (
            <tr
              key={cache.cacheId}
              className="storage-cache-row"
              tabIndex={0}
              onClick={() => onOpen(cache.cacheId)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen(cache.cacheId)
              }}>
              <td>
                <div className="storage-cache-name">
                  <strong>{resolveStorageCacheText(cache.displayName, cache.displayNameI18n, language)}</strong>
                  {cache.sensitivity === 'none' ? null : (
                    <small className="storage-cache-flag" title={formatSensitivity(cache.sensitivity, labels)}>
                      {labels.flagSensitive}
                    </small>
                  )}
                </div>
                <small className="storage-cache-owner">
                  {formatOwner(cache, labels)} · {formatCategory(cache.category, labels)}
                </small>
              </td>
              <td className="storage-cache-align-end storage-cache-num">
                {formatBytes(inspection?.sizeBytes, labels.emptyValue)}
              </td>
              <td className="storage-cache-align-end storage-cache-num">{inspection?.recordCount ?? labels.emptyValue}</td>
              <td>
                <span className="storage-cache-status" data-status={inspection?.status ?? 'unknown'}>
                  <i />
                  {formatInspectionStatus(inspection?.status, labels)}
                </span>
              </td>
              <td
                className="storage-cache-updated"
                title={formatAbsoluteTime(inspection?.lastUpdatedAt, language)}>
                {inspection?.lastUpdatedAt
                  ? formatRelativeTime(inspection.lastUpdatedAt, language)
                  : labels.emptyValue}
              </td>
              <td className="storage-cache-align-end">
                <div className="storage-cache-row-actions" onClick={(event) => event.stopPropagation()}>
                  {cache.clearable ? (
                    <button type="button" className="storage-cache-action" onClick={() => onClear(cache)}>
                      {labels.clear}
                    </button>
                  ) : null}
                  {cache.compactable ? (
                    <button type="button" className="storage-cache-action" onClick={() => onCompact(cache)}>
                      {labels.compact}
                    </button>
                  ) : null}
                  {cache.clearable || cache.compactable ? null : <span className="storage-cache-muted">—</span>}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
