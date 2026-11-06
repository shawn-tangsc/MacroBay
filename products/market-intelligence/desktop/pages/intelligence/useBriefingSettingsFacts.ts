import { useEffect, useState } from 'react'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

/**
 * The three facts the brief page needs from settings, and when to read them again.
 *
 * All three come from one read: web search being on (the banner's business), an unreadable generation
 * zone (automatic runs are paused, so the page must say so), and a stored language this build cannot
 * write in. They are read together because they are the same answer — three separate reads would be
 * three chances to disagree about which settings were in force.
 *
 * `reloadSettings` is exported rather than hidden: the drawer and the window's focus both mean "read
 * again", and the page passes the same counter to the push block so nothing keeps a stale copy.
 */
export function useBriefingSettingsFacts(client: Readonly<{
  getSettings?: DailyBriefingClient['getSettings']
}>): Readonly<{
  webSearchEnabled: boolean | null
  languageFallback: string | null
  zoneInvalid: string | null
  settingsReloadKey: number
  reloadSettings: () => void
}> {
  const [settingsReloadKey, setSettingsReloadKey] = useState(0)
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean | null>(null)
  const [languageFallback, setLanguageFallback] = useState<string | null>(null)
  const [zoneInvalid, setZoneInvalid] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!client.getSettings) return undefined
    void client.getSettings().then((result) => {
      if (!active || result.state !== 'available') return
      setWebSearchEnabled(result.view.settings.webSearchEnabled)
      setZoneInvalid(result.view.generation.periods?.[0]?.generationTimeZoneInvalid ?? null)
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

  return { webSearchEnabled, languageFallback, zoneInvalid, settingsReloadKey, reloadSettings: () => setSettingsReloadKey((key) => key + 1) }
}
