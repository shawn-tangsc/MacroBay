import { useEffect, useState, type ReactElement } from 'react'

import { Checkbox, Select } from 'antd'

import {
  CALENDAR_LANDED_COUNTRY_CODES,
  MAX_CALENDAR_LANDED_COUNTRIES,
  type CalendarLandedCountryCode,
  type CalendarLandedCountryScope,
  type CalendarLandedCountrySelection
} from '../../../contracts/calendarLandedCountries'
import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'
import { SettingField } from '../../shared/settings/SettingField'
import { SettingsRow } from './settingsRow'

/**
 * 「发生后」段里的「哪些国家的数据」：三项下拉 + 自选国家清单。
 *
 * 三条行为约束（原型 v2 定稿）：
 * - **值只从服务读**，写完服务端说了算；但**存失败时保留读者刚选的值**（本地草稿），
 *   不退回默认——退回默认会让读者以为「本来就选这个」。
 * - 上限 = 名单长度（契约里的 `MAX_CALENDAR_LANDED_COUNTRIES`）：选满后未勾的项置灰，
 *   计数变 `8 / 8` 并出现「最多选 8 个」；`n ≤ 7` 时那句不出现。
 * - 文案全部走 i18n 键，组件内零句子。
 */
const ROW_CLASS = 'intelligence-notification-form-row'
const LABEL_CLASS = 'intelligence-notification-form-label'
const LABEL_TEXT_CLASS = 'intelligence-notification-form-label-text'
const CONTROL_CLASS = 'intelligence-notification-form-control'

/** 国家两行的声明：按 key 找，不兜底——声明缺了就是编译/测试的红。 */
function countryDescriptor(key: string): SettingDescriptor {
  const descriptor = settingRegistry.notifications.find((row) => row.key === key)
  if (!descriptor) throw new Error(`missing setting descriptor: ${key}`)
  return descriptor
}

export function CalendarLandedCountriesRow(props: Readonly<{
  selection: CalendarLandedCountrySelection
  saving: boolean
  /** 哪一处保存失败；只有这里是 `landedCountries` 才在这一行提示。 */
  saveFailedField?: string
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  onChange: (next: CalendarLandedCountrySelection) => void
  last?: boolean
}>): ReactElement {
  const { selection, saving, saveFailedField, text } = props
  // 草稿：服务端确认前先显示读者刚选的；存失败也不回退。
  //
  // **重置只看这个字段自己的值有没有变，不看对象引用**：服务端每次保存成功后回的都是新对象，
  // 引用一变就 `setDraft` 等于「别的字段存成功」也会把这里没存上的草稿悄悄抹掉——读者刚选的
  // 国家就这么没了，而且没有任何提示。用内容做键，别的字段保存（本字段内容不变）就不动草稿。
  const confirmedKey = `${selection.scope}:${selection.codes.join(',')}`
  const [draft, setDraft] = useState(selection)
  useEffect(() => { setDraft(selection) }, [confirmedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = text['pages.intelligence.notification.countries.row'] ?? ''
  const count = draft.codes.length
  const full = count >= MAX_CALENDAR_LANDED_COUNTRIES

  const choose = (next: CalendarLandedCountrySelection): void => {
    setDraft(next)
    props.onChange(next)
  }
  const chooseScope = (scope: CalendarLandedCountryScope): void => {
    choose(scope === 'custom' ? { scope, codes: draft.codes } : { scope, codes: [] })
  }
  const toggleCode = (code: CalendarLandedCountryCode, checked: boolean): void => {
    if (checked && count >= MAX_CALENDAR_LANDED_COUNTRIES) return
    const codes = checked
      ? [...draft.codes, code]
      : draft.codes.filter((entry) => entry !== code)
    choose({ scope: 'custom', codes })
  }

  const options = (['us', 'all', 'custom'] as const).map((scope) => ({
    value: scope,
    label: text[`pages.intelligence.notification.countries.${scope}`] ?? scope
  }))

  return <>
    <SettingField
      busy={saving}
      controlWrapperClassName={CONTROL_CLASS}
      copyClassName={LABEL_CLASS}
      descriptor={countryDescriptor('setting:notifications.calendar.landed-countries.scope')}
      labelTextClassName={LABEL_TEXT_CLASS}
      onChange={(next) => chooseScope(next as CalendarLandedCountryScope)}
      resolveOptionLabel={(option) =>
        text[`pages.intelligence.notification.countries.${String(option)}`] ?? String(option)}
      resolveText={props.resolveText}
      rowClassName={ROW_CLASS}
      selectStyle={{ minWidth: 180 }}
      value={draft.scope}
      view={{ landedCountries: draft }}
    />
    {draft.scope === 'custom'
      ? <SettingField
        busy={saving}
        controlWrapperClassName={CONTROL_CLASS}
        copyClassName={LABEL_CLASS}
        descriptor={countryDescriptor('setting:notifications.calendar.landed-countries.codes')}
        labelTextClassName={LABEL_TEXT_CLASS}
        onChange={(next) => {
          const codes = Array.isArray(next) ? next.map(String) as CalendarLandedCountryCode[] : []
          choose({ scope: 'custom', codes })
        }}
        resolveOptionLabel={(option) =>
          text[`pages.intelligence.notification.countries.name.${String(option)}`] ?? String(option)}
        resolveText={props.resolveText}
        rowClassName={ROW_CLASS}
        value={draft.codes}
        view={{ landedCountries: draft }}
      >
        <span
          className={`intelligence-notification-form-note${full ? ' is-caution' : ''}`}
          data-count={`${count}/${MAX_CALENDAR_LANDED_COUNTRIES}`}
        >
          {(text['pages.intelligence.notification.countries.count'] ?? '{count} / {max}')
            .replace('{count}', String(count))
            .replace('{max}', String(MAX_CALENDAR_LANDED_COUNTRIES))}
        </span>
        {/* 空选不是空态：给指路句，不留一个只有计数的空框。 */}
        {count === 0
          ? <span className="intelligence-notification-form-note" role="status">
            {text['pages.intelligence.notification.countries.emptyHintState']}
          </span>
          : null}
        {full
          ? <span className="intelligence-notification-form-note is-caution" role="status">
            {text['pages.intelligence.notification.countries.fullHint']}
          </span>
          : null}
      </SettingField>
      : null}
    {saveFailedField === 'landedCountries'
      ? <SettingsRow label="" last={props.last}>
        <span className="intelligence-notification-form-note" role="status">
          {text['pages.intelligence.notification.countries.saveFailed']}
        </span>
      </SettingsRow>
      : null}
  </>
}
