import type { ReactElement, ReactNode } from 'react'

import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { SettingField } from '../../shared/settings/SettingField'

/**
 * 三条内容项的详情：一行一件事，只有「推不推频道」这一个控件；需要时可在它下面追加一行。
 *
 * 行由 `SettingField` 按声明渲染；页面只保留外壳（动作组、追加行、保存失败状态）。
 * 值、保存中、失败仍由页面/hook 持有——组件不持有 IO。
 */
export function ContentDetail(props: Readonly<{
  descriptor: SettingDescriptor
  enabled: boolean
  saving: boolean
  failed: boolean
  saveFailedText: string
  resolveText: (key: string) => string
  onChange: (enabled: boolean) => void
  /** 控件右侧的动作组（测试按钮 + ⓘ）；同一行内、不新增列。 */
  action?: ReactNode
  /** 追加在这一行下面的行（舆情那一项用它放「强度门槛」）。 */
  children?: ReactNode
  /**
   * 行名旁那颗 ⓘ 画不画：设置页把它省掉（那一屏有一处整组 ⓘ），抽屉里它必须跟着这一行
   * ——「为什么勾了还不响」的解释不能飘在别处。句子来自声明里的 `helpKey`，不在这里写。
   */
  showHelp?: boolean
}>): ReactElement {
  const last = props.children === undefined
  return <div className="intelligence-notification-content-detail">
    <SettingField
      busy={props.saving}
      controlWrapperClassName="intelligence-notification-form-control"
      copyClassName="intelligence-notification-form-label"
      descriptor={props.descriptor}
      labelTextClassName="intelligence-notification-form-label-text"
      onChange={(next) => props.onChange(next === true)}
      resolveOptionLabel={() => ''}
      resolveText={props.resolveText}
      showHelp={props.showHelp ?? false}
      rowClassName={`intelligence-notification-form-row${last ? ' is-last' : ''}`}
      value={props.enabled}
      view={{}}
    >
      {props.action ?? null}
    </SettingField>
    {props.children}
    {props.failed
      ? <p className="intelligence-notification-form-note" role="status">{props.saveFailedText}</p>
      : null}
  </div>
}
