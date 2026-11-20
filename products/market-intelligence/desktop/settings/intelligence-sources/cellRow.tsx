import { Info } from 'lucide-react'

import { Switch } from 'antd'
import type React from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { SettingsInfo } from '../settingsInfo'
import { FrequencyReadout, frequencyReadoutLine, frequencyReadoutText } from './FrequencyReadout'
import { BusinessCardFrequencyRow } from './BusinessCardFrequencyRow'
import { SOURCE_ROW_TEMPLATES, sourceRowAttributes } from './sourceSettingRows'
import { frequencyReadoutView, type SourceCadenceReadout } from './sourceCadence'

import type { ProviderDetailLabels } from './ProviderDetail'

/**
 * 一条源项行（看板与核心指标**共用这一份**）。
 *
 * 从 `BusinessSettingsView` 拆出来：它是这个文件里最长的一段（约 130 行），并且被两个屏直接调用。
 * 「照抄页面要抄渲染函数，不是抄 class」这条规矩说的就是它——所以它值得有自己的文件与守卫。
 */
export function cellRow(args: {
  cellId: string
  enabled: boolean
  label: string
  sourceId: string
  siblings: readonly string[]
  /** 源自己的采集开关；`false` = 源没开（这一项不可编辑，红辉光，点击去配置它）。 */
  sourceEnabled?: boolean
  onCellToggle?: (cellId: string, enabled: boolean) => void
  onOpenSourceConfig?: (sourceId: string) => void
  /** 这个源当前的采集预设；给了才画第二行（未启用/待接入/无采集的源不给）。 */
  preset?: string
  onPresetChange?: (next: string) => void
  /** 节奏由产品内置：第二行只写「内置频率」这个值，不画任何启停/采集控件。 */
  builtinCadence?: boolean
  /** 这个源的调度事实（没有作业就没有这一格）。 */
  cadence?: SourceCadenceReadout
  /** 这一批排期没读到：读数不画，ⓘ 里说明。 */
  cadenceUnavailable?: boolean
  resolveText: (key: string) => string
  /** 显示时区（读数里「下次」的时刻按读者设置格式化）。 */
  timeZone: string
}): React.ReactElement {
  const { cellId, enabled, label, siblings, onCellToggle, sourceId } = args
  const sourceOff = args.sourceEnabled === false
  /* 频率读数（2026-11-13 界面设计改口径）：**不再占正文那一行**，整条收进 ⓘ 的浮层、
     放在解释句之前当第一行——读者点开第一眼就是当前值。正文只剩「频率 ⓘ + 下拉」。 */
  const readoutView = args.preset === undefined
    ? undefined
    : frequencyReadoutView({
      enabled: !sourceOff,
      preset: args.preset,
      scheduleAvailable: args.cadenceUnavailable !== true,
      ...(args.cadence === undefined ? {} : { cadence: args.cadence })
    })
  const toggleKey = enabled
    ? 'settings.intelligenceSources.cellEnabled.disable'
    : 'settings.intelligenceSources.cellEnabled.enable'
  const onSelect = (next: boolean): void => {
    if (onCellToggle === undefined) return
    if (next) {
      // 同一格只留一个源：先关同组其它源，再开这一个（顺序固定，避免出现同时开着的中间态）。
      for (const sibling of siblings) onCellToggle(sibling, false)
      onCellToggle(cellId, true)
      return
    }
    onCellToggle(cellId, false)
  }
  const openConfig = (): void => {
    if (!sourceOff || args.onOpenSourceConfig === undefined) return
    args.onOpenSourceConfig(sourceId)
  }
  return <div
    aria-label={sourceOff ? args.resolveText('settings.intelligenceSources.openSourceConfig').replace('{name}', label) : undefined}
    className="business-card__row"
    data-business-row={sourceId}
    data-cell-enabled={enabled ? 'true' : 'false'}
    data-cell-id={cellId}
    data-source-disabled={sourceOff ? 'true' : undefined}
    key={cellId}
    onClick={sourceOff ? openConfig : undefined}
    onKeyDown={sourceOff
      ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        openConfig()
      }
      : undefined}
    role={sourceOff ? 'button' : undefined}
    tabIndex={sourceOff ? 0 : undefined}>
    <div className="business-card__line">
    {sourceOff || args.onOpenSourceConfig === undefined
      /* 源没开：整行是按钮（这一行只能去配置），名字不再单独做按钮——按钮套按钮是嵌套交互。
         源开着：名字是**真按钮**（原生 button，键盘可达），行本身不是按钮。 */
      ? <span className="business-card__label">{label}</span>
      : <button
        aria-label={args.resolveText('settings.intelligenceSources.openSourceConfig').replace('{name}', label)}
        className="business-card__label business-card__label--action"
        onClick={(event) => {
          // 名字是这一行唯一的交互目标；行本身没有点击，这里不必反向阻止，但也不许冒泡给卡片。
          event.stopPropagation()
          args.onOpenSourceConfig!(sourceId)
        }}
        type="button">{label}</button>}
    {onCellToggle === undefined
      ? null
      : <span
        className="business-card__toggle"
        /* 开关只切换，不许冒泡成「点整行跳转」（红辉光那一行整行可点）。 */
        onClick={(event) => event.stopPropagation()}>
        <Switch
          aria-disabled={sourceOff ? true : undefined}
          aria-label={args.resolveText(toggleKey).replace('{cell}', label)}
          checked={enabled}
          disabled={sourceOff}
          onChange={onSelect}
          size="small" />
      </span>}
    </div>
    {/* 第二行：频率（产品 2026-11-12 定：与「开不开」同一屏决定「采多勤」）。
        **源没开就不画**——那一行整行是跳配置的按钮，行里不能再嵌一个下拉（嵌套交互）。
        这一行由共享组件渲染：核心指标那一屏用的是同一个组件（不再手拼一遍，否则一定漏掉 ⓘ）。 */}
    {sourceOff
      ? null
      : <BusinessCardFrequencyRow
        {...(args.builtinCadence === true
          ? { builtinCadence: true, dataRow: { 'data-preset-row': sourceId } }
          : {
            dataRow: { 'data-preset-row': sourceId, ...sourceRowAttributes(SOURCE_ROW_TEMPLATES.collectionPreset, sourceId) },
            ...(args.preset === undefined ? {} : { preset: args.preset }),
            ...(args.onPresetChange === undefined ? {} : { onPresetChange: args.onPresetChange }),
            /* 只读调用方（核心指标那一屏）不传 `onPresetChange`：那时频率行必须是**读数**，
               不能画一个点了没反应的下拉——那是假控件。 */
            ...(args.preset !== undefined && args.onPresetChange === undefined ? { readOnly: true } : {})
          })}
        {...(args.cadence === undefined ? {} : { cadence: args.cadence })}
        {...(args.cadenceUnavailable === true ? { cadenceUnavailable: true } : {})}
        resolveText={args.resolveText}
        timeZone={args.timeZone} />}
  </div>
}

/**
 * 频率那一行：**两页共用的唯一一份**（看板的每一格、核心指标的每一条腿）。
 *
 * 三个形态：
 * - `builtinCadence`：节奏由产品内置作业定 —— 标签 + 「为什么内置」那颗 ⓘ + 值（有真实排期就读真值）；
 * - 可调档（给了 `preset` + `onPresetChange`）：标签 + 同一颗四行 ⓘ + 档位下拉；
 * - `readOnly`（核心指标这屏）：标签 + **同一颗四行 ⓘ** + 读数文字（没有下拉）。
 *
 * 为什么要抽出来：两页各写一遍时，核心指标那屏漏掉了 ⓘ（用户 2026-11-14 截图），
 * 补一个细节就要再改一轮。ⓘ 的内容（三档实际间隔 / 下次是推算 / 手动档 / 排期读不到）
 * 也只在这里写一次。
 */
