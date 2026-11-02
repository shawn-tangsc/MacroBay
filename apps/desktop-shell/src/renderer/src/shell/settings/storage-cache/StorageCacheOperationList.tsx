import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { StateView } from '@platform/ui/components/state'
import type { CacheOperationAuditRecord, SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import {
  formatAbsoluteTime,
  formatOperationStatus,
  formatRelativeTime,
  type StorageCacheLabels
} from './storageCacheDisplay'
import { formatStorageOperationType, resolveStorageCacheText } from './storageCacheViewModel'

type StorageCacheOperationListProps = {
  language: AppLanguage
  labels: StorageCacheLabels
  records: CacheOperationAuditRecord[]
  caches: SafeCacheView[]
  showCacheName?: boolean
}

export function StorageCacheOperationList({
  language,
  labels,
  records,
  caches,
  showCacheName = false
}: StorageCacheOperationListProps): React.ReactElement {
  if (records.length === 0) {
    // 「还没有操作」是事实、没有下一步：不解释、不给按钮，也不再用一句本地灰字。
    return <StateView state="empty" reasonCode="not-yet" size="sm" />
  }

  const cacheNames = new Map(
    caches.map((cache) => [
      cache.cacheId,
      resolveStorageCacheText(cache.displayName, cache.displayNameI18n, language)
    ])
  )

  return (
    <table className="storage-cache-history">
      <thead>
        <tr>
          {showCacheName ? <th scope="col">{labels.historyColumnCache}</th> : null}
          <th scope="col">{labels.historyColumnOperation}</th>
          <th scope="col">{labels.historyColumnResult}</th>
          <th scope="col" className="storage-cache-history-time">
            {labels.historyColumnTime}
          </th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.operationId}>
            {showCacheName ? (
              <td className="storage-cache-history-cache">{cacheNames.get(record.cacheId) ?? record.cacheId}</td>
            ) : null}
            <td>{formatStorageOperationType(record.operation, language)}</td>
            <td>
              <span className="storage-cache-history-result" data-status={record.status}>
                {formatOperationStatus(record.status, labels)}
              </span>
              {record.dryRun ? <span className="storage-cache-muted"> · {labels.historyDryRun}</span> : null}
            </td>
            <td className="storage-cache-history-time" title={formatAbsoluteTime(record.completedAt ?? record.requestedAt, language)}>
              {formatRelativeTime(record.completedAt ?? record.requestedAt, language)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
