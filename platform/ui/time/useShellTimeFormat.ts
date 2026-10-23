import { useCallback } from 'react'

import { useShellLanguage } from '../shell/ShellLanguageContext'
import { useShellTimeZone } from '../shell/ShellTimeZoneContext'
import { formatShellInstant, type ShellTimePrecision } from './shellTimeFormat'

/**
 * Owner: platform/ui/time。
 *
 * 展示层格式化一个 UTC 瞬时的唯一入口：时区来自窗口级 `ShellTimeZoneProvider`，语言来自 `ShellLanguageProvider`，
 * 产品不得再自己拼接 `' UTC'`（真机症状：中国用户看到凌晨 3 点的分析时间）。精度按用途显式传入：
 * 审计/时间轴用秒，观测值用分。
 */
export function useShellTimeFormat(): (instant: string, precision?: ShellTimePrecision) => string {
  const timeZone = useShellTimeZone()
  const locale = useShellLanguage()
  return useCallback(
    (instant: string, precision: ShellTimePrecision = 'minute') => formatShellInstant(instant, { timeZone, locale, precision }),
    [locale, timeZone]
  )
}
