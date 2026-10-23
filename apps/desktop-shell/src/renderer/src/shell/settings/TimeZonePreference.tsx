import { useMemo } from 'react'
import { Select } from 'antd'
import { Globe2 } from 'lucide-react'

import {
  fallbackTimeZone,
  systemTimeZoneSetting,
  type AppLanguage,
  type TimeZoneSetting
} from '@platform/settings/schema/appSettings'
import { formatShellTimeZoneLabel, resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'

import { platformText } from '../../i18n/platformText'

/**
 * Owner: apps/desktop-shell renderer / shell（基础设置 · 时区）。
 *
 * 存储与 IPC 上的时间始终是 UTC 瞬时，因此**显示**用哪个时区必须是用户可确认的一项设置：默认「跟随系统」
 * （真机症状：中国用户看到凌晨 3 点的分析时间），需要时再显式选一个 IANA 时区。
 *
 * 候选来自 `Intl.supportedValuesOf('timeZone')`（运行时权威列表，时区名不落 i18n 词表）；运行时提供不了
 * 该 API 时只给「跟随系统」与 UTC 兜底，绝不编造一段时区清单。每项都带当前的 `GMT±n`，避免同名缩写歧义。
 */
export function TimeZonePreference(props: {
  language: AppLanguage
  value: TimeZoneSetting
  onChange: (value: TimeZoneSetting) => void
}): React.ReactElement {
  const t = platformText[props.language].preferences
  const systemTimeZone = useMemo(() => resolveSystemTimeZone(), [])
  const options = useMemo(
    () => [
      { value: systemTimeZoneSetting, label: `${t.timeZoneFollowSystem}（${formatShellTimeZoneLabel(systemTimeZone, props.language)}）` },
      ...supportedTimeZoneOptions().map((timeZone) => ({
        value: timeZone,
        label: `${timeZone}（${formatShellTimeZoneLabel(timeZone, props.language)}）`
      }))
    ],
    [props.language, systemTimeZone, t.timeZoneFollowSystem]
  )

  return (
    <div className="preference-section">
      <div className="preference-heading">
        <Globe2 size={18} />
        <span>{t.timeZone}</span>
      </div>
      <Select<TimeZoneSetting>
        className="preference-select"
        showSearch
        value={props.value}
        options={options}
        placeholder={t.timeZoneSearch}
        filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        onChange={props.onChange}
      />
      {systemTimeZone === fallbackTimeZone && props.value === systemTimeZoneSetting ? (
        <p className="preference-hint">{t.timeZoneUnavailable}</p>
      ) : null}
    </div>
  )
}

/**
 * 运行时可用的 IANA 时区 id。`Intl.supportedValuesOf` 缺失或抛错时只回落 UTC：宁可少给选项，也不猜测。
 */
export function supportedTimeZoneOptions(): readonly string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supportedValuesOf !== 'function') return [fallbackTimeZone]
  try {
    const values = supportedValuesOf.call(Intl, 'timeZone')
    return values.length > 0 ? values : [fallbackTimeZone]
  } catch {
    return [fallbackTimeZone]
  }
}
