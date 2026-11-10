import { Button } from 'antd'
import { CircleSlash, TriangleAlert } from 'lucide-react'
import type { ReactElement } from 'react'

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

/** 表格里的一格：整行仍以字段名开头，右侧是状态词（规范 §2.2）。 */
export function CellStateRow({ id, name, kind, label, colSpan }: {
  id: string
  name: string
  kind: CellStateKind
  label: string
  colSpan: number
}): ReactElement {
  return (
    <tr aria-disabled="true" data-source-state={kind} data-status-row={id}>
      <th scope="row"><span>{name}</span></th>
      <td colSpan={colSpan}><CellStateSentence kind={kind} label={label} /></td>
    </tr>
  )
}

/** 整卡：标题 + 一句状态 + 一颗主动作（规范 §2.1）。 */
export function CellStateCard({ title, kind, label, action, onSelect }: {
  title: string
  kind: CellStateKind
  label: string
  action?: string
  onSelect?: () => void
}): ReactElement {
  return (
    <section className="mi-source-card" data-source-state={kind}>
      <h3 className="mi-source-card__title">{title}</h3>
      <CellStateSentence kind={kind} label={label} />
      {action === undefined || onSelect === undefined
        ? null
        : <div className="mi-source-card__actions">
          <Button onClick={onSelect} size="small" type="default">{action}</Button>
        </div>}
    </section>
  )
}
