import { useCallback, useEffect, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type {
  IntelligenceTranslationSettings,
  SafeIntelligenceTranslationSettings,
  SafeTranslationModuleStatus
} from '../../../service/intelligence/schema/intelligenceTranslation'
import { intelligenceTranslationClient } from '../../shared/ipc/intelligenceTranslationClient'

export function useIntelligenceTranslationSettings(labels: {
  saveFailed: string
  queueFailed: string
  queueQueued: string
}) {
  const [settings, setSettings] = useState<SafeIntelligenceTranslationSettings>()
  const [moduleStatus, setModuleStatus] = useState<SafeTranslationModuleStatus>()
  const [modelProviders, setModelProviders] = useState<SafeModelProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [queuing, setQueuing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

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
    void load().catch(() => setErrorCode(labels.saveFailed))
  }, [labels.saveFailed, load])

  const updateSettings = useCallback(
    async (patch: Partial<IntelligenceTranslationSettings>) => {
      setSaving(true)
      setErrorCode(null)
      try {
        const next = await intelligenceTranslationClient.saveSettings(patch)
        setSettings(next)
        setModuleStatus(await intelligenceTranslationClient.getModuleStatus())
      } catch {
        setErrorCode(labels.saveFailed)
      } finally {
        setSaving(false)
      }
    },
    [labels.saveFailed]
  )

  const queueMissing = useCallback(async () => {
    setQueuing(true)
    setNotice(null)
    setErrorCode(null)
    try {
      await intelligenceTranslationClient.queueMissing({
        reason: 'manual-selection',
        filters: { timeRange: '7d', limit: 50 }
      })
      setNotice(labels.queueQueued)
      setModuleStatus(await intelligenceTranslationClient.getModuleStatus())
    } catch {
      setErrorCode(labels.queueFailed)
    } finally {
      setQueuing(false)
    }
  }, [labels.queueFailed, labels.queueQueued])

  return {
    settings,
    moduleStatus,
    modelProviders,
    saving,
    queuing,
    notice,
    errorCode,
    updateSettings,
    queueMissing
  }
}
