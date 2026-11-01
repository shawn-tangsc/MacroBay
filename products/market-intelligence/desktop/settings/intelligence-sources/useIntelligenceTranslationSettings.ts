import { useCallback, useEffect, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type {
  IntelligenceTranslationSettings,
  SafeIntelligenceTranslationSettings,
  SafeTranslationModuleStatus
} from '../../../service/intelligence/schema/intelligenceTranslation'
import { intelligenceTranslationClient } from '../../shared/ipc/intelligenceTranslationClient'

/** One click may not queue the whole history: the cap is the cost limit, not a time window. */
const TRANSLATION_QUEUE_LIMIT = 50

export function useIntelligenceTranslationSettings(labels: {
  saveFailed: string
  queueFailed: string
  queueQueued: string
}) {
  const [settings, setSettings] = useState<SafeIntelligenceTranslationSettings>()
  const [moduleStatus, setModuleStatus] = useState<SafeTranslationModuleStatus>()
  const [modelProviders, setModelProviders] = useState<SafeModelProvider[]>([])
  const [saving, setSaving] = useState(false)
  /** True only after a save succeeded in this session; loading a saved file is not a save. */
  const [savedThisSession, setSavedThisSession] = useState(false)
  const [queuing, setQueuing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // A sentence from the product text, never a code: the card renders it as-is.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [nextSettings, nextStatus, providers] = await Promise.all([
      intelligenceTranslationClient.getSettings(),
      intelligenceTranslationClient.getModuleStatus(),
      window.platform?.modelProviders?.list() as Promise<SafeModelProvider[]>
    ])
    setSettings(nextSettings)
    setModuleStatus(nextStatus)
    setModelProviders(providers ?? [])
  }, [])

  useEffect(() => {
    void load().catch(() => setErrorMessage(labels.saveFailed))
  }, [labels.saveFailed, load])

  const updateSettings = useCallback(
    async (patch: Partial<IntelligenceTranslationSettings>) => {
      setSaving(true)
      setErrorMessage(null)
      try {
        const next = await intelligenceTranslationClient.saveSettings(patch)
        setSettings(next)
        setSavedThisSession(true)
        setModuleStatus(await intelligenceTranslationClient.getModuleStatus())
      } catch {
        setSavedThisSession(false)
        setErrorMessage(labels.saveFailed)
      } finally {
        setSaving(false)
      }
    },
    [labels.saveFailed]
  )

  /**
   * Queues whatever is still untranslated for the sources the card sits under.
   *
   * The limit stays: it caps what one click can cost. The time window does not — the page shows no
   * time filter, so a fixed 7-day window would silently drop older pending items and still call
   * itself "the current selection".
   */
  const queueMissing = useCallback(async (sourceIds?: readonly string[]) => {
    setQueuing(true)
    setNotice(null)
    setErrorMessage(null)
    try {
      await intelligenceTranslationClient.queueMissing({
        reason: 'manual-selection',
        filters: {
          ...(sourceIds && sourceIds.length > 0 ? { sourceIds: [...sourceIds] } : {}),
          limit: TRANSLATION_QUEUE_LIMIT
        }
      })
      setNotice(labels.queueQueued)
      setModuleStatus(await intelligenceTranslationClient.getModuleStatus())
    } catch {
      setErrorMessage(labels.queueFailed)
    } finally {
      setQueuing(false)
    }
  }, [labels.queueFailed, labels.queueQueued])

  return {
    settings,
    moduleStatus,
    modelProviders,
    saving,
    savedThisSession,
    queuing,
    notice,
    errorMessage,
    updateSettings,
    queueMissing
  }
}
