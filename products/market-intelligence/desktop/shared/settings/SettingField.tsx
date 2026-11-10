import type { ReactElement, ReactNode } from 'react'

import { Checkbox, InputNumber, Select, Switch } from 'antd'

import { Segmented } from '@platform/ui/components/segmented'
import { SettingsRow } from '@platform/ui/components/settings-row'

import { SettingsInfo } from '../../settings/settingsInfo'
import {
  SETTING_OPTION_SETS,
  readViewField,
  type SettingDescriptor,
  type SettingOptionsRef,
  type SettingOptionsSource
} from './descriptorTypes'

/**
 * 一条声明 → 一行设置。C2 第 2 步的唯一字段组件。
 *
 * 边界（与产品/Chief 2026-11-10 对齐，别在这里开例外）：
 * - **不持有 IO，也不持有行级状态**：值、`saving`、`failed` 都在页面/hook 里；失败提示与
 *   保存中提示由调用方渲染成 `children` 传进来，组件只负责「标签 + 控件」。
 * - **控件原语按现状取**：`switch` 用 antd `Switch`、`select` 默认 antd `Select`（声明可要求
 *   平台 `Segmented`）、`multiSelect` 用 antd `Checkbox`、`number` 用 `InputNumber`。
 * - **`visibleWhen` 假 = 不渲染**（不是置灰、不是 CSS 隐藏）；它只读页面传进来的 `view`（能力事实也拼在 view 里）。
 * - `data-setting-key` 挂在行容器上，守卫按它认行；组件不拿文案或类名当锚点。
 * - 标签与 ⓘ 的句子都经 `resolveText` 解析；组件不写任何可见字面量。
 */
export type SettingFieldProps = Readonly<{
  descriptor: SettingDescriptor
  /** 这一行的视图：`read` 的结果 + （按实例化的行）实例键与投影事实。 */
  view: unknown
  /** 按实例化的行的**具体**键（模板里的 `<sourceId>` 已替换）；静态行不用给。 */
  instanceKey?: string
  /** 当前值（`switch` 用布尔、`select` 用单值、`multiSelect` 用数组、`readonly` 用文本）。 */
  value: unknown
  rowClassName: string
  copyClassName: string
  controlWrapperClassName?: string
  headClassName?: string
  disabled?: boolean
  /** 控件级「正在保存」表现（switch 的 loading）；状态本身仍由页面持有。 */
  busy?: boolean
  /**
   * 是否把说明渲染成 ⓘ。默认渲染（声明有说明就该能看）；
   * 迁移旧屏时若该行现状没有 ⓘ，调用方显式传 `false` 以保 A1 的 DOM 不变。
   */
  showHelp?: boolean
  onChange?: (next: unknown) => void
  /** 行名、说明、ⓘ 读屏名都从这里解析；不在这里拼句子。 */
  resolveText: (key: string) => string
  /** 选项句子：值在注册表，句子在文案表，由页面解析；视图来源没有静态集合名。 */
  resolveOptionLabel: (value: string | number, source?: SettingOptionsSource) => string
  /** ⓘ 的读屏名（旧调用点用；声明里的 `copy.helpAriaKey` 优先）。 */
  helpAriaLabelKey?: string
  /** 行名字自身的类名（各屏现状不同，由调用方给，保 A1 的 DOM 逐字不变）。 */
  labelTextClassName?: string
  /** `multiSelect` 每一项的类名（各屏现状不同，由调用方给）。 */
  checkboxClassName?: string
  /** `select`（antd）的样式；旧屏给过 `minWidth` 的由调用方传，保 DOM 不变。 */
  selectStyle?: Readonly<Record<string, string | number>>
  /** `unimplemented` 的一行说明，由页面给句子。 */
  unimplementedText?: string
  /** 页面渲染的行级状态（保存中 / 存不上）。组件不生产、不改写、不吞掉。 */
  children?: ReactNode
}>

export function SettingField(props: SettingFieldProps): ReactElement | null {
  const { descriptor } = props
  if (descriptor.visibleWhen && !descriptor.visibleWhen(props.view)) return null

  // 按实例化的行的行名是**数据**（来源名 / feed 名）；静态行才用文案键。
  const label = descriptor.labelText ? descriptor.labelText(props.view) : props.resolveText(descriptor.copy?.labelKey ?? '')
  // 说明：单条简写 helpKey 或多条 helpKeys，两者互斥；读屏名优先用声明里的 helpAriaKey。
  const helpKeys = descriptor.copy?.helpKeys
    ?? (descriptor.copy?.helpKey === undefined ? [] : [descriptor.copy.helpKey])
  const helpAriaKey = descriptor.copy?.helpAriaKey ?? props.helpAriaLabelKey ?? helpKeys[0]
  const info = helpKeys.length === 0 || helpAriaKey === undefined || props.showHelp === false
    ? null
    : <SettingsInfo
      ariaLabelKey={helpAriaKey}
      labelKeys={helpKeys}
      resolveText={props.resolveText}
    />
  const row = (children: ReactNode): ReactElement => <SettingsRow
    copyClassName={props.copyClassName}
    headClassName={props.headClassName}
    label={<><span className={props.labelTextClassName}>{label}</span>{info}</>}
    rowAttributes={{ 'data-setting-key': props.instanceKey ?? descriptor.key }}
    rowClassName={props.rowClassName}
    {...(props.controlWrapperClassName === undefined ? {} : { controlWrapperClassName: props.controlWrapperClassName })}
  >
    {children}
    {props.children}
  </SettingsRow>

  if (descriptor.availability === 'unimplemented') {
    // 未实现项没有控件：一行说明就够，不画一个「以后能开」的灰控件。
    return row(<span className="intelligence-notification-form-note" role="note">{props.unimplementedText ?? ''}</span>)
  }

  switch (descriptor.field.kind) {
    case 'switch':
      return row(<Switch
        aria-label={label}
        checked={props.value === true}
        disabled={props.disabled === true || props.busy === true}
        loading={props.busy === true}
        onChange={(next) => props.onChange?.(next)}
      />)
    case 'select': {
      const options = optionsOf(descriptor.field.optionsFrom, props.view, props.resolveOptionLabel)
      if ((descriptor.field.presentation ?? 'select') === 'segmented') {
        const ariaLabelKey = descriptor.copy?.labelKey ?? ''
        const optionByValue = new Map(options.map((option) => [String(option.value), option]))
        return row(<Segmented
          ariaLabelKey={ariaLabelKey}
          items={options.map((option) => ({ value: String(option.value), labelKey: String(option.value) }))}
          onChange={(next) => {
            // Segmented 的值是字符串；原值是数字的（如提前量分钟）按原类型回写。
            const picked = optionByValue.get(next)
            props.onChange?.(typeof picked?.value === 'number' ? Number(next) : next)
          }}
          resolveText={(key) => {
            if (key === ariaLabelKey) return label
            const option = optionByValue.get(key)
            return option === undefined ? '' : option.label
          }}
          value={String(props.value ?? '')}
        />)
      }
      return row(<Select
        aria-label={label}
        disabled={props.disabled === true || props.busy === true}
        onChange={(next) => props.onChange?.(next)}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
        size="small"
        {...(props.selectStyle === undefined ? {} : { style: props.selectStyle })}
        value={props.value as string | number | undefined}
      />)
    }
    case 'multiSelect':
      return row(<MultiSelect
        ariaLabel={label}
        disabled={props.disabled === true || props.busy === true}
        checkboxClassName={props.checkboxClassName}
        onChange={props.onChange}
        options={optionsOf(descriptor.field.optionsFrom, props.view, props.resolveOptionLabel)}
        value={props.value}
      />)
    case 'number':
      return row(<InputNumber
        aria-label={label}
        disabled={props.disabled === true || props.busy === true}
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

type ResolvedOption = Readonly<{ value: string | number; label: string }>

/**
 * 解析一行选项：静态集合（真闭集）或视图来源（`{ kind: 'view', field }`）。
 * 视图来源只接受字符串/数字数组；没有这一格就是空，不猜。
 */
function optionsOf(
  from: SettingOptionsRef,
  view: unknown,
  resolveOptionLabel: (value: string | number, source?: SettingOptionsSource) => string
): readonly ResolvedOption[] {
  if (typeof from !== 'string') {
    const raw = readViewField(view, from.field)
    const values = Array.isArray(raw)
      ? raw.filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
      : []
    return values.map((value) => ({ value, label: resolveOptionLabel(value) }))
  }
  return SETTING_OPTION_SETS[from].map((option) => ({
    value: option.value,
    label: resolveOptionLabel(option.value, from)
  }))
}

function MultiSelect(props: Readonly<{
  ariaLabel: string
  checkboxClassName?: string
  disabled: boolean
  onChange?: (next: unknown) => void
  options: readonly ResolvedOption[]
  value: unknown
}>): ReactElement {
  const selected = Array.isArray(props.value) ? props.value.map(String) : []
  const toggle = (option: string, checked: boolean): void => {
    props.onChange?.(
      checked
        ? [...selected.filter((value) => value !== option), option]
        : selected.filter((value) => value !== option)
    )
  }
  return <div aria-label={props.ariaLabel} className="intelligence-notification-form-checks" role="group">
    {props.options.map((option) => {
      const key = String(option.value)
      return <Checkbox
        checked={selected.includes(key)}
        className={props.checkboxClassName}
        disabled={props.disabled}
        key={key}
        onChange={(event) => toggle(key, event.target.checked)}
      >
        {option.label}
      </Checkbox>
    })}
  </div>
}

function formatReadonly(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return String(value)
  return ''
}
