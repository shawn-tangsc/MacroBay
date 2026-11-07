import type { ReactElement } from 'react'

import { Switch } from 'antd'

import { SettingsRow } from './settingsRow'

/** 三条内容项的详情：一行一件事，只有「推不推手机」这一个控件。 */
export function ContentDetail(props: Readonly<{
  name: string
  enabled: boolean
  saving: boolean
  failed: boolean
  saveFailedText: string
  onChange: (enabled: boolean) => void
}>): ReactElement {
  return <div className="intelligence-notification-content-detail">
    <SettingsRow label={props.name} last>
      <Switch
        aria-label={props.name}
        checked={props.enabled}
        disabled={props.saving}
        loading={props.saving}
        onChange={props.onChange}
      />
    </SettingsRow>
    {props.failed
      ? <p className="intelligence-notification-form-note" role="status">{props.saveFailedText}</p>
      : null}
  </div>
}
