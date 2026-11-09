import type { ReactElement, ReactNode } from 'react'

import { Checkbox, InputNumber, Select, Switch } from 'antd'

import { SettingsRow } from '@platform/ui/components/settings-row'

import { SettingsInfo } from '../../settings/settingsInfo'
import {
  SETTING_OPTION_SETS,
  type SettingDescriptor,
  type SettingOptionsSource
} from './descriptorTypes'

/**
 * 一条声明 → 一行设置。C2 第 2 步的唯一字段组件。
 *
 * 边界（与产品/Chief 2026-11-10 对齐，别在这里开例外）：
 * - **不持有 IO，也不持有行级状态**：值、`saving`、`failed` 都在页面/hook 里；失败提示与
 *   保存中提示由调用方渲染成 `children` 传进来，组件只负责「标签 + 控件」。
 * - **控件原语按现状取**：antd `Switch` / `Select` / `Checkbox` / `InputNumber`；换原语是
 *   视觉变化，得界面设计签字，不在这个组件里顺手做。
 * - **`visibleWhen` 假 = 不渲染**（不是置灰、不是 CSS 隐藏）；它只读页面传进来的 `view`。
 * - `data-setting-key` 挂在行容器上，守卫按它认行；组件不拿文案或类名当锚点。
 * - 标签与 ⓘ 的句子都经 `resolveText` 解析；组件不写任何可见字面量。
 */
export type SettingFieldProps = Readonly<{
  descriptor: SettingDescriptor
  /** 这一行的视图：`read` 的结果 + （按实例化的行）实例键与投影事实。 */
  view: unknown
  /** 当前值（`switch` 用布尔、`select` 用单值、`multiSelect` 用数组、`readonly` 用文本）。 */
  value: unknown
  rowClassName: string
  copyClassName: string
  controlWrapperClassName?: string
  headClassName?: string
  disabled?: boolean
  onChange?: (next: unknown) => void
  /** 行名、说明、ⓘ 读屏名都从这里解析；不在这里拼句子。 */
  resolveText: (key: string) => string
  /** 选项句子：值在注册表，句子在文案表，由页面解析。 */
  resolveOptionLabel: (source: SettingOptionsSource, value: string | number) => string
  /** ⓘ 的读屏名。缺省用说明键本身（它只进读屏，不上屏）。 */
  helpAriaLabelKey?: string
  /** 行名字自身的类名（各屏现状不同，由调用方给，保 A1 的 DOM 逐字不变）。 */
  labelTextClassName?: string
  /** `unimplemented` 的一行说明，由页面给句子。 */
  unimplementedText?: string
  /** 页面渲染的行级状态（保存中 / 存不上）。组件不生产、不改写、不吞掉。 */
  children?: ReactNode
}>

export function SettingField(props: SettingFieldProps): ReactElement | null {
  const { descriptor } = props
  if (descriptor.visibleWhen && !descriptor.visibleWhen(props.view)) return null

  const label = props.resolveText(descriptor.copy.labelKey)
  const info = descriptor.copy.helpKey === undefined
    ? null
    : <SettingsInfo
      ariaLabelKey={props.helpAriaLabelKey ?? descriptor.copy.helpKey}
      labelKeys={[descriptor.copy.helpKey]}
      resolveText={props.resolveText}
    />
  const row = (children: ReactNode): ReactElement => <SettingsRow
    copyClassName={props.copyClassName}
    headClassName={props.headClassName}
    label={<>
      <span className={props.labelTextClassName}>{label}</span>
      {info}
    </>}
    rowAttributes={{ 'data-setting-key': descriptor.key }}
    rowClassName={props.rowClassName}
    {...(props.controlWrapperClassName === undefined ? {} : { controlWrapperClassName: props.controlWrapperClassName })}
  >
    {children}
    {props.children}
  </SettingsRow>

  if (descriptor.availability === 'unimplemented') {
    // 未实现项没有控件：一行说明就够，不画一个「以后能开」的灰控件。
    return row(<span className="intelligence-notification-form-note" role="status">{props.unimplementedText ?? ''}</span>)
  }

  switch (descriptor.field.kind) {
    case 'switch':
      return row(<Switch
        aria-label={label}
        checked={props.value === true}
        disabled={props.disabled === true}
        onChange={(next) => props.onChange?.(next)}
        size="small"
      />)
    case 'select': {
      const optionsFrom = descriptor.field.optionsFrom
      return row(<Select
        aria-label={label}
        disabled={props.disabled === true}
        onChange={(next) => props.onChange?.(next)}
        options={optionsOf(optionsFrom).map((option) => ({
          value: option.value,
          label: props.resolveOptionLabel(optionsFrom, option.value)
        }))}
        size="small"
        value={props.value as string | number | undefined}
      />)
    }
    case 'multiSelect':
      return row(<MultiSelect
        ariaLabel={label}
        disabled={props.disabled === true}
        onChange={props.onChange}
        optionsFrom={descriptor.field.optionsFrom}
        resolveOptionLabel={props.resolveOptionLabel}
        value={props.value}
      />)
    case 'number':
      return row(<InputNumber
        aria-label={label}
        disabled={props.disabled === true}
        max={descriptor.field.max}
        min={descriptor.field.min}
        onChange={(next) => props.onChange?.(next)}
        size="small"
        step={descriptor.field.step}
        value={typeof props.value === 'number' ? props.value : undefined}
      />)
    case 'readonly':
      return row(<span className="intelligence-setting-readonly">{formatReadonly(props.value)}</span>)
  }
}

function MultiSelect(props: Readonly<{
  ariaLabel: string
  disabled: boolean
  onChange?: (next: unknown) => void
  optionsFrom: SettingOptionsSource
  resolveOptionLabel: (source: SettingOptionsSource, value: string | number) => string
  value: unknown
}>): React.ReactElement {
  const selected = Array.isArray(props.value) ? props.value.map(String) : []
  const options = optionsOf(props.optionsFrom)
  // 固定项（如通知中心）永远在值里：关掉它不是一个可选操作，值里也绝不能少。
  const locked = options.filter((option) => option.locked === true).map((option) => String(option.value))
  const toggle = (option: string, checked: boolean): void => {
    const next = checked
      ? [...selected.filter((value) => value !== option), option]
      : selected.filter((value) => value !== option)
    props.onChange?.([...locked, ...next.filter((value) => !locked.includes(value))])
  }
  return <div aria-label={props.ariaLabel} className="intelligence-notification-form-checks" role="group">
    {options.map((option) => {
      const key = String(option.value)
      const checked = option.locked === true || selected.includes(key)
      return <Checkbox
        checked={checked}
        disabled={props.disabled || option.locked === true}
        key={key}
        onChange={(event) => toggle(key, event.target.checked)}
      >
        {props.resolveOptionLabel(props.optionsFrom, option.value)}
      </Checkbox>
    })}
  </div>
}

function optionsOf(source: SettingOptionsSource): readonly Readonly<{ value: string | number; locked?: boolean }>[] {
  return SETTING_OPTION_SETS[source]
}

function formatReadonly(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return String(value)
  return ''
}
