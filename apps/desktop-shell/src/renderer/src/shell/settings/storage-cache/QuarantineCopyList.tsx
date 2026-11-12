import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { QuarantineCopyScan } from '@platform/storage/quarantine/quarantineCopies'
import { formatShellInstant, resolveShellTimeZone } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

import { formatBytes } from './storageCacheDisplay'
import type { StorageCacheLabels } from './storageCacheDisplay'

/**
 * 隔离副本清单：文件 / 位置 / 大小 / 修改时间。
 *
 * 只列、不动：这一块**没有删除动作**——副本不参与读取，删不删是读者自己的事，界面先把
 * 「这是什么、在哪儿、多大」说清（说明句在标题旁的 ⓘ 里）。
 * 时间与缓存表一样走统一格式化、按读者设置时区显示；不在这里自己拼 `YYYY/M/D`。
 */
export function QuarantineCopyList(props: Readonly<{
  language: AppLanguage
  labels: StorageCacheLabels
  scan: QuarantineCopyScan
}>): React.ReactElement {
  const timeZone = useShellTimeZone()

  return <table className="storage-cache-history">
    <thead>
      <tr>
        <th scope="col">{props.labels.quarantineColumnFile}</th>
        <th scope="col">{props.labels.quarantineColumnLocation}</th>
        <th scope="col">{props.labels.quarantineColumnSize}</th>
        <th scope="col" className="storage-cache-history-time">{props.labels.quarantineColumnModified}</th>
      </tr>
    </thead>
    <tbody>
      {props.scan.copies.map((copy) => <tr key={copy.relativePath}>
        <td className="storage-cache-history-cache">{copy.fileName}</td>
        <td>{copy.relativePath}</td>
        <td>{formatBytes(copy.sizeBytes, props.labels.emptyValue)}</td>
        <td className="storage-cache-history-time">
          {formatShellInstant(copy.modifiedAt, { timeZone: resolveShellTimeZone(timeZone), locale: props.language })}
        </td>
      </tr>)}
    </tbody>
  </table>
}
