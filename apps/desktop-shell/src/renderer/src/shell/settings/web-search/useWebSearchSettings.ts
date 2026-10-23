import { useEffect, useState } from 'react'

import type {
  SafeWebSearchProviderView,
  UpdateWebSearchProviderInput,
  WebSearchCheckProviderRequest,
  WebSearchCheckProviderResponse,
  WebSearchProviderId,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'

export type WebSearchSettingsState = {
  loading: boolean
  error: string | null
  settings: WebSearchSettings | null
  providers: SafeWebSearchProviderView[]
  reload: () => Promise<void>
  updateSettings: (patch: Partial<WebSearchSettings>) => Promise<WebSearchSettings>
  updateProvider: (input: UpdateWebSearchProviderInput) => Promise<SafeWebSearchProviderView>
  checkProvider: (input: WebSearchCheckProviderRequest) => Promise<WebSearchCheckProviderResponse>
  revealApiKey: (providerId: WebSearchProviderId) => Promise<string | null>
}

export function useWebSearchSettings(): WebSearchSettingsState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<WebSearchSettings | null>(null)
  const [providers, setProviders] = useState<SafeWebSearchProviderView[]>([])

  async function reload(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, nextProviders] = await Promise.all([
        window.platform.webSearch.getSettings(),
        window.platform.webSearch.listProviders()
      ])
      setSettings(nextSettings as WebSearchSettings)
      setProviders(nextProviders as SafeWebSearchProviderView[])
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  async function updateSettings(patch: Partial<WebSearchSettings>): Promise<WebSearchSettings> {
    const nextSettings = (await window.platform.webSearch.updateSettings(patch)) as WebSearchSettings
    setSettings(nextSettings)
    return nextSettings
  }

  async function updateProvider(input: UpdateWebSearchProviderInput): Promise<SafeWebSearchProviderView> {
    const provider = (await window.platform.webSearch.updateProvider(input)) as SafeWebSearchProviderView
    setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)))
    const nextSettings = (await window.platform.webSearch.getSettings()) as WebSearchSettings
    setSettings(nextSettings)
    return provider
  }

  async function checkProvider(input: WebSearchCheckProviderRequest): Promise<WebSearchCheckProviderResponse> {
    return (await window.platform.webSearch.checkProvider(input)) as WebSearchCheckProviderResponse
  }

  async function revealApiKey(providerId: WebSearchProviderId): Promise<string | null> {
    const result = (await window.platform.webSearch.revealApiKey(providerId)) as { apiKey?: string | null }
    return result.apiKey ?? null
  }

  useEffect(() => {
    void reload()
  }, [])

  return {
    loading,
    error,
    settings,
    providers,
    reload,
    updateSettings,
    updateProvider,
    checkProvider,
    revealApiKey
  }
}
