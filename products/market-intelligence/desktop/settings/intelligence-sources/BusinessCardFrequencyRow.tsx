import { Info } from 'lucide-react'

import { Select } from 'antd'
import type React from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { SettingsInfo } from '../settingsInfo'
import { FrequencyReadout, frequencyReadoutLine, frequencyReadoutText } from './FrequencyReadout'
import { SOURCE_ROW_TEMPLATES, sourceRowAttributes } from './sourceSettingRows'
import { frequencyReadoutView, type SourceCadenceReadout } from './sourceCadence'

/** 可调档只这三档（与看板那三档同一组值，不另立第二套）。 */
const PRESET_VALUES = ['manual', 'balanced', 'frequent'] as const

/**
 * 频率那一行：**看板的每一格、核心指标的每一条腿共用这一份**。
 *
 * 从 `BusinessSettingsView` 拆出来，是因为它已经是一个独立子组件（三个形态：内置频率 / 可调档 /
 * 只读读数），被两个屏引用。
 */
export function BusinessCardFrequencyRow(props: Readonly<{
  dataRow?: Readonly<Record<string, string | undefined>>
  preset?: string
  onPresetChange?: (next: string) => void
  builtinCadence?: boolean
  /** 只读一行：核心指标那屏没有档位下拉，只有读数 + 同一颗 ⓘ。 */
  readOnly?: boolean
  cadence?: SourceCadenceReadout
  cadenceUnavailable?: boolean
  resolveText: (key: string) => string
  timeZone: string
}>): React.ReactElement | null {
  const t = props.resolveText
  const builtin = props.builtinCadence === true
  const adjustable = props.preset !== undefined && props.onPresetChange !== undefined
  if (!builtin && !adjustable && props.readOnly !== true) return null
  const view = frequencyReadoutView({
    enabled: true,
    ...(props.preset === undefined ? {} : { preset: props.preset }),
    scheduleAvailable: props.cadenceUnavailable !== true,
    ...(props.cadence === undefined ? {} : { cadence: props.cadence })
  })
  return <div className="business-card__preset" {...props.dataRow} data-preset-builtin={builtin ? 'true' : undefined}>
    <span className="business-card__preset-label-group">
      <span className="business-card__preset-label">{t('settings.intelligenceSources.collectionPolicy.frequency')}</span>
      {builtin
        /* 内置节奏那颗 ⓘ 说的是「为什么内置」，与可调档那颗四行 ⓘ 不是同一份。 */
        ? <SettingsInfo
          ariaLabelKey="settings.intelligenceSources.collectionPolicy.builtinCadenceNoteAria"
          labelKeys={['settings.intelligenceSources.collectionPolicy.builtinCadenceNote']}
          resolveText={t} />
        : <Popover
          /* 固定 4 条（界面设计 2026-11-13 v4）：① 当前值（只有它随状态变）② 三档实际间隔
             ③「下次」是推算 ④ 手动/读不到两条边界。任何状态都不得长出第 5 条。
             两页共用这一份，逐字相同。 */
          lines={[
            /* 带参数的函数调用直接写在数组里：守卫已经把函数括号深度算进去，四项就是四项
               （`0944ab3` 之前它会把参数逗号数成项，这里曾为此提前算成变量）。 */
            frequencyReadoutLine(view, props.timeZone, t),
            { labelKey: 'settings.intelligenceSources.collectionPolicy.presetIntervalsNote' },
            { labelKey: 'settings.intelligenceSources.collectionPolicy.nextIsEstimateNote' },
            { labelKey: 'settings.intelligenceSources.collectionPolicy.readoutEdgesNote' }
          ]}
          resolveText={t}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="settings.intelligenceSources.collectionPolicy.manualPresetNoteAria"
              icon={Info}
              resolveText={t}
              size="sm"
              variant="plain" />
          )} />}
    </span>
    {builtin
      ? props.cadence === undefined
        ? <span className="business-card__preset-value">{t('settings.intelligenceSources.collectionPolicy.builtinCadence')}</span>
        : <FrequencyReadout resolveText={t} view={view} />
      : adjustable
        ? <Select
          aria-label={t('settings.intelligenceSources.collectionPolicy.collectionPreset')}
          className="business-card__preset-select"
          onChange={props.onPresetChange}
          options={PRESET_VALUES.map((value) => ({
            value,
            label: t(`settings.intelligenceSources.collectionPolicy.presets.${value}`)
          }))}
          size="small"
          value={props.preset} />
        : <span className="business-card__preset-readout">{frequencyReadoutText(view, props.timeZone, t)}</span>}
  </div>
}
