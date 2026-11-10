import { useEffect, useState } from 'react'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

/**
 * The two facts the brief page needs from settings, and when to read them again.
 *
 * Both come from one read: web search being on (the banner's business) and a stored language this
 * build cannot write in. They are read together because they are the same answer — two separate
 * reads would be two chances to disagree about which settings were in force.
 *
 * The generation zone left this list: a period stores a wall-clock time and means the reader's zone,
 * so there is no stored zone left that could be unreadable.
 *
 * `reloadSettings` is exported rather than hidden: the drawer and the window's focus both mean "read
 * again", and the page passes the same counter to the push block so nothing keeps a stale copy.
 */
export function useBriefingSettingsFacts(client: Readonly<{
  getSettings?: DailyBriefingClient['getSettings']
}>): Readonly<{
  webSearchEnabled: boolean | null
  languageFallback: string | null
  settingsReloadKey: number
  reloadSettings: () => void
}> {
  const [settingsReloadKey, setSettingsReloadKey] = useState(0)
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null)
  const [languageFallback, setLanguageFallback] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!client.getSettings) return undefined
    void client.getSettings().then((result) => {
      if (!active || result.state !== 'available') return
      setWebSearchEnabled(result.view.settings.webSearchEnabled)
      const plan = result.view.language.plan.primary
      setLanguageFallback(plan.fallbackReason === 'ui-language-unsupported' ? plan.requested : null)
    }).catch(() => undefined)
    return () => { active = false }
  }, [client, settingsReloadKey])

  // A setting changed in the drawer (or in another window) takes effect without a reload.
  useEffect(() => {
    const bump = (): void => setSettingsReloadKey((key) => key + 1)
    const onVisibility = (): void => { if (document.visibilityState === 'visible') bump() }
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { webSearchEnabled, languageFallback, settingsReloadKey, reloadSettings: () => setSettingsReloadKey((key) => key + 1) }
}
