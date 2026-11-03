import { useEffect, useState } from 'react'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/** The brief page's content language: the one place that reads or writes it. */
export const CONTENT_LOCALE_STORAGE_KEY = 'macroBay.dailyBriefing.contentLocale'

const isLocale = (value: unknown): value is DailyBriefingLocale => value === 'zh-CN' || value === 'en-US'

function read(fallback: DailyBriefingLocale): DailyBriefingLocale {
  try {
    const stored = window.localStorage.getItem(CONTENT_LOCALE_STORAGE_KEY)
    return isLocale(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

export function useBriefingContentLocale(interfaceLocale: DailyBriefingLocale): readonly [DailyBriefingLocale, (locale: DailyBriefingLocale) => void] {
  const [locale, setLocale] = useState<DailyBriefingLocale>(() => read(interfaceLocale))
  useEffect(() => {
    try {
      window.localStorage.setItem(CONTENT_LOCALE_STORAGE_KEY, locale)
    } catch {
      // Storage disabled: the switch still works, it just does not survive a restart.
    }
  }, [locale])
  return [locale, setLocale] as const
}
