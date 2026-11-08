import { useCallback, useEffect, useState } from 'react'

import type { CalendarLandedFilter, CalendarReminderImportance, CalendarReminderLeadMinutes } from '../../../contracts/calendarEventReminder'
import {
  intelligenceReminderClient,
  type CalendarReminderClient,
  type CalendarReminderSettingsView
} from '../../shared/ipc/intelligenceReminderClient'

/**
 * 「开始前」那一段的读写（设置 → 情报 → 通知 → 日历事件）。
 *
 * 三条硬规矩：
 * - **值只从服务读**：写完重新读一次，不做本地乐观更新——写没写进去由服务端说了算；
 * - **失败回滚并就地提示**：不假装成功；
 * - 页面不在这里推三层「与」：它只把这个对象显示出来。
 */

export type CalendarReminderSettingsState = Readonly<{
  status: 'loading' | 'ready' | 'error'
  value?: CalendarReminderSettingsView
  saving: boolean
  saveFailed: boolean
  reload: () => void
  update: (patch: Readonly<Partial<{
    enabled: boolean
    leadMinutes: CalendarReminderLeadMinutes
    importance: readonly CalendarReminderImportance[]
    landedFilter: CalendarLandedFilter
  }>>) => void
}>

export function useCalendarReminderSettings(
  client: CalendarReminderClient = intelligenceReminderClient
): CalendarReminderSettingsState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [value, setValue] = useState<CalendarReminderSettingsView>()
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [token, setToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void client.read().then(
      (next) => { if (!cancelled) { setValue(next); setStatus('ready') } },
      () => { if (!cancelled) setStatus('error') }
    )
    return () => { cancelled = true }
  }, [client, token])

  const reload = useCallback(() => setToken((current) => current + 1), [])

  const update = useCallback((patch: Parameters<CalendarReminderSettingsState['update']>[0]) => {
    setSaving(true)
    setSaveFailed(false)
    void client.write(patch).then(
      (next) => { setValue(next); setSaving(false) },
      () => { setSaving(false); setSaveFailed(true) }
    )
  }, [client])

  return { status, ...(value === undefined ? {} : { value }), saving, saveFailed, reload, update }
}
