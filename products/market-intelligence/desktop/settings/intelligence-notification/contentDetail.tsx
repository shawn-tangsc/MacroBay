import type { ReactElement, ReactNode } from 'react'

import { Switch } from 'antd'

import { SettingsRow } from './settingsRow'

/** 三条内容项的详情：一行一件事，只有「推不推频道」这一个控件；需要时可在它下面追加一行。 */
export function ContentDetail(props: Readonly<{
  name: string
  enabled: boolean
  saving: boolean
  failed: boolean
  saveFailedText: string
  onChange: (enabled: boolean) => void
  /** 追加在这一行下面的行（舆情那一项用它放「强度门槛」）。 */
  children?: ReactNode
}>): ReactElement {
  return <div className="intelligence-notification-content-detail">
    <SettingsRow label={props.name} last={props.children === undefined}>
      <Switch
        aria-label={props.name}
        checked={props.enabled}
        disabled={props.saving}
        loading={props.saving}
        onChange={props.onChange}
      />
    </SettingsRow>
    {props.children}
    {props.failed
      ? <p className="intelligence-notification-form-note" role="status">{props.saveFailedText}</p>
      : null}
  </div>
}
