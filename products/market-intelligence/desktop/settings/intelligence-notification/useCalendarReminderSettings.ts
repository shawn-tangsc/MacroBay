import { useCallback, useEffect, useState } from 'react'

import type { CalendarLandedFilter, CalendarReminderImportance, CalendarReminderLeadMinutes } from '../../../contracts/calendarEventReminder'
import type { CalendarLandedCountrySelection } from '../../../contracts/calendarLandedCountries'
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
  /** 任一处保存失败（兼容既有调用方）。 */
  saveFailed: boolean
  /** 失败发生在哪一处；页面据此只在那一行提示，不把「国家没存上」写到别的组里。 */
  saveFailedField?: string
  reload: () => void
  update: (patch: Readonly<Partial<{
    enabled: boolean
    leadMinutes: CalendarReminderLeadMinutes
    importance: readonly CalendarReminderImportance[]
    landedFilter: CalendarLandedFilter
    landedCountries: CalendarLandedCountrySelection
  }>>) => void
}>

export function useCalendarReminderSettings(
  client: CalendarReminderClient = intelligenceReminderClient
): CalendarReminderSettingsState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [value, setValue] = useState<CalendarReminderSettingsView>()
  const [saving, setSaving] = useState(false)
  const [saveFailedField, setSaveFailedField] = useState<string>()
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
    const field = Object.keys(patch)[0]
    setSaving(true)
    // 只清**这一处自己**的旧失败提示。别处保存不该把「国家没存上」擦掉——那处的读者草稿还没存上，
    // 提示消失等于告诉读者「已经好了」。
    setSaveFailedField((current) => (current === field ? undefined : current))
    void client.write(patch).then(
      (outcome) => {
        setSaving(false)
        // 没存上：不拿旧值覆盖读者刚选的（界面自己保留草稿），只报"这次没存上"。
        if (outcome.state === 'saved') setValue(outcome.settings)
        else setSaveFailedField(field)
      },
      () => { setSaving(false); setSaveFailedField(field) }
    )
  }, [client])

  return {
    status,
    ...(value === undefined ? {} : { value }),
    saving,
    saveFailed: saveFailedField !== undefined,
    ...(saveFailedField === undefined ? {} : { saveFailedField }),
    reload,
    update
  }
}
