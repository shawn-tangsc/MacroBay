import { useEffect, useRef, useState } from 'react'

import type {
  SafeWebSearchProviderView,
  UpdateWebSearchProviderInput,
  WebSearchCapability,
  WebSearchCheckProviderRequest,
  WebSearchCheckProviderResponse
} from '@platform/ai/web-search/contracts/webSearchContracts'
import type { PlatformText } from '../../../i18n/platformText'

type UseProviderSettingsDraftParams = {
  labels: PlatformText['webSearch']
  provider: SafeWebSearchProviderView
  onSave: (input: UpdateWebSearchProviderInput) => Promise<void>
  onCheck: (input: WebSearchCheckProviderRequest) => Promise<WebSearchCheckProviderResponse>
}

/**
 * 供应商设置草稿：
 * - 开关 / 默认能力是「立即保存」字段（只提交自己的 patch，绝不带草稿 Key）；
 * - 文本类（Key、API 地址、Searxng 的 engines/basic auth）才计入 dirty，需显式保存。
 */
export function useProviderSettingsDraft({ labels, provider, onSave, onCheck }: UseProviderSettingsDraftParams) {
  const [enabled, setEnabled] = useState(provider.enabled)
  const [apiKey, setApiKey] = useState('')
  const [apiHostByCapability, setApiHostByCapability] = useState<Record<string, string>>(() => ({
    ...(provider.apiHostByCapability as Record<string, string>)
  }))
  const [engines, setEngines] = useState('')
  const [basicAuthUsername, setBasicAuthUsername] = useState('')
  const [basicAuthPassword, setBasicAuthPassword] = useState('')
  const [defaultForCapabilities, setDefaultForCapabilities] = useState<WebSearchCapability[]>(provider.defaultForCapabilities)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toggleSaving, setToggleSaving] = useState(false)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [checkErrorCode, setCheckErrorCode] = useState<string | null>(null)
  const [checkStatus, setCheckStatus] = useState<number | null>(null)
  const providerIdRef = useRef(provider.id)

  useEffect(() => {
    setEnabled(provider.enabled)
    setApiKey('')
    setApiHostByCapability({ ...(provider.apiHostByCapability as Record<string, string>) })
    setEngines('')
    setBasicAuthUsername('')
    setBasicAuthPassword('')
    setDefaultForCapabilities(provider.defaultForCapabilities)
    // 同一供应商的自动保存回填不清掉「已启用/已停用」内联提示；切换供应商才清。
    if (providerIdRef.current !== provider.id) {
      providerIdRef.current = provider.id
      setStatus(null)
    }
  }, [provider])

  const isSearxng = provider.id === 'searxng'
  const dirty =
    apiKey.trim().length > 0 ||
    JSON.stringify(apiHostByCapability) !== JSON.stringify(provider.apiHostByCapability) ||
    (isSearxng && (engines.length > 0 || basicAuthUsername.length > 0 || basicAuthPassword.length > 0))

  function splitList(value: string): string[] {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function textPatch(): UpdateWebSearchProviderInput {
    const patch: UpdateWebSearchProviderInput = { providerId: provider.id, apiHostByCapability }
    if (apiKey.trim()) patch.apiKeys = splitList(apiKey)
    if (isSearxng) {
      patch.engines = splitList(engines)
      patch.basicAuthUsername = basicAuthUsername
      if (basicAuthPassword.trim()) patch.basicAuthPassword = basicAuthPassword
    }
    return patch
  }

  async function saveText(): Promise<void> {
    if (!dirty || saving) return
    setSaving(true)
    setStatus(null)
    try {
      await onSave(textPatch())
      setStatus(labels.saved)
    } catch (error) {
      setStatus(`${labels.saveFailed}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(next: boolean): Promise<void> {
    const previous = enabled
    setEnabled(next)
    setToggleSaving(true)
    setStatus(null)
    try {
      // 只提交开关，绝不携带 apiKey / engines / basicAuth 草稿。
      await onSave({ providerId: provider.id, enabled: next })
      setStatus(labels.savedImmediately(next))
    } catch (error) {
      setEnabled(previous)
      setStatus(`${labels.toggleSaveFailed}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setToggleSaving(false)
    }
  }

  async function changeDefaults(next: WebSearchCapability[]): Promise<void> {
    const previous = defaultForCapabilities
    setDefaultForCapabilities(next)
    setDefaultsSaving(true)
    setStatus(null)
    try {
      await onSave({ providerId: provider.id, defaultForCapabilities: next })
      setStatus(labels.saved)
    } catch (error) {
      setDefaultForCapabilities(previous)
      setStatus(`${labels.defaultSaveFailed}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDefaultsSaving(false)
    }
  }

  async function removeApiKey(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      await onSave({ providerId: provider.id, apiKeys: [] })
      setStatus(labels.saved)
    } catch (error) {
      setStatus(`${labels.saveFailed}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function check(): Promise<void> {
    setChecking(true)
    setStatus(null)
    setCheckErrorCode(null)
    setCheckStatus(null)
    try {
      const result = await onCheck({
        providerId: provider.id,
        capability: provider.capabilities[0]?.feature,
        draft: {
          enabled,
          apiKeys: apiKey.trim() ? splitList(apiKey) : undefined,
          apiHostByCapability,
          engines: splitList(engines),
          basicAuthUsername,
          basicAuthPassword: basicAuthPassword.trim() ? basicAuthPassword : undefined
        }
      })
      const detail =
        result.errorCode === 'provider_unauthorized'
          ? `${labels.invalidApiKeyError(result.status ?? 401)} [${result.errorCode}]`
          : result.errorCode === 'missing_api_key'
            ? `${labels.missingApiKey} [${result.errorCode}]`
            : result.errorCode === 'provider_response_invalid'
              ? `${labels.providerResponseInvalid} [${result.errorCode}]`
              : (result.message ?? result.errorCode ?? '')
      setCheckErrorCode(result.valid ? null : (result.errorCode ?? null))
      setCheckStatus(result.valid ? null : (result.status ?? null))
      setStatus(result.valid ? labels.checkSucceeded : `${labels.checkFailed}: ${detail}`)
    } catch (error) {
      setCheckErrorCode(null)
      setCheckStatus(null)
      setStatus(`${labels.checkFailed}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setChecking(false)
    }
  }

  return {
    enabled,
    apiKey,
    apiHostByCapability,
    engines,
    basicAuthUsername,
    basicAuthPassword,
    defaultForCapabilities,
    checking,
    saving,
    toggleSaving,
    defaultsSaving,
    status,
    checkErrorCode,
    checkStatus,
    dirty,
    setApiKey,
    setApiHostByCapability,
    setEngines,
    setBasicAuthUsername,
    setBasicAuthPassword,
    saveText,
    toggleEnabled,
    changeDefaults,
    removeApiKey,
    check
  }
}
