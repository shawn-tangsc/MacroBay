import { CircleSlash, TriangleAlert } from 'lucide-react'
import type { ReactElement } from 'react'

import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import '../../shared/styles/sourceAvailability.css'

/**
 * 「这一格现在能不能显示数据」的三态里，本线用到的两种（`disabled` / `unreadable`）。
 *
 * 样式与类名归共享文件 `sourceAvailability.css`，调用点只给 `data-state` 与一句文案，
 * **不写颜色、不写图标尺寸**。没配置那一态（`missing`）不在这条线：看板每一格都在注册表里。
 */
export type CellStateKind = 'disabled' | 'unreadable'

function CellStateSentence({ kind, label }: { kind: CellStateKind; label: string }): ReactElement {
  const Icon = kind === 'unreadable' ? TriangleAlert : CircleSlash
  return (
    <span className="mi-source-state" data-state={kind}>
      <Icon aria-hidden="true" className="mi-source-state__icon" size={14} />
      {label}
    </span>
  )
}

/** 行级：未配置/未启用不可点（`aria-disabled`）；**读不到可点重试**（真按钮，整句就是它的名字）。 */
export function CellStateRow({ id, name, kind, label, colSpan, onRetry }: {
  id: string
  name: string
  kind: CellStateKind
  label: string
  colSpan: number
  onRetry?: () => void
}): ReactElement {
  const Icon = kind === 'unreadable' ? TriangleAlert : CircleSlash
  const state = (
    <>
      <Icon aria-hidden="true" className="mi-source-state__icon" size={14} />
      {label}
    </>
  )
  return (
    <tr aria-disabled={kind === 'unreadable' ? undefined : 'true'} data-source-state={kind} data-status-row={id}>
      <th scope="row"><span>{name}</span></th>
      <td colSpan={colSpan}>
        {kind === 'unreadable' && onRetry !== undefined
          ? <button className="mi-source-state" data-state={kind} onClick={onRetry} type="button">{state}</button>
          : <span className="mi-source-state" data-state={kind}>{state}</span>}
      </td>
    </tr>
  )
}

/**
 * 整卡级按规范用 `StateView`（不是共享卡）：不画自己的标题与外壳，状态面、图标、动作都归平台。
 * 一句话走 `productReason`，动作各一颗：没启用 → 去启用；读不到 → 再试一次。
 */
export function CellStateCard({ kind, label, onSelect }: {
  kind: CellStateKind
  label: string
  onSelect: () => void
}): ReactElement {
  return kind === 'unreadable'
    ? <StateView state="error" reasonCode="unreadable" size="md"
        productReason={{ key: 'mi.dashboard.cellSourceUnreadable', resolve: () => label }}
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect }} />
    : <StateView state="disabled" reasonCode="target-disabled" size="md"
        productReason={{ key: 'mi.dashboard.cellNotEnabled', resolve: () => label }}
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.enable, onSelect }} />
}
