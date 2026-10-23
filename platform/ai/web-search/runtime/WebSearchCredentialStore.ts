import { maskSecret as platformMaskSecret } from '@platform/ai/providers/providerStore'
import type { WebSearchProviderId } from '../contracts/webSearchContracts'

export type WebSearchProviderSecrets = {
  apiKeys: string[]
  basicAuthPassword?: string
}

export type WebSearchProviderSecretPatch = {
  apiKeys?: string[]
  basicAuthPassword?: string
  preserveExisting?: boolean
}

export type WebSearchProviderSecretView = {
  hasApiKey: boolean
  apiKeyPreview: string
  apiKeyLength: number
  hasBasicAuth: boolean
}

export type WebSearchCredentialState = {
  providers: Partial<Record<WebSearchProviderId, WebSearchProviderSecrets>>
}

export type WebSearchCredentialStorage = {
  read: () => Promise<unknown>
  write: (state: WebSearchCredentialState) => Promise<void>
}

export type WebSearchCredentialStore = {
  getProviderSecrets: (providerId: WebSearchProviderId) => Promise<WebSearchProviderSecrets>
  /** 只读、按需：返回第一条非空 API Key（绝不写日志/不缓存到安全视图）。 */
  getProviderApiKey: (providerId: WebSearchProviderId) => Promise<string | null>
  updateProviderSecrets: (providerId: WebSearchProviderId, patch: WebSearchProviderSecretPatch) => Promise<void>
  clearProviderSecrets: (providerId: WebSearchProviderId) => Promise<void>
  toSafeView: (providerId: WebSearchProviderId) => Promise<WebSearchProviderSecretView>
}

export function createWebSearchCredentialStore(storage?: WebSearchCredentialStorage): WebSearchCredentialStore {
  let state: WebSearchCredentialState | null = null

  async function load(): Promise<WebSearchCredentialState> {
    if (state) return state
    state = normalizeCredentialState(storage ? await storage.read() : undefined)
    return state
  }

  async function save(nextState: WebSearchCredentialState): Promise<void> {
    state = nextState
    await storage?.write(nextState)
  }

  return {
    async getProviderSecrets(providerId) {
      return { ...((await load()).providers[providerId] ?? { apiKeys: [] }) }
    },
    async getProviderApiKey(providerId) {
      const secrets = (await load()).providers[providerId] ?? { apiKeys: [] }
      const key = secrets.apiKeys.find((item) => item.trim().length > 0)
      return key ? key.trim() : null
    },
    async updateProviderSecrets(providerId, patch) {
      const current = await load()
      const existing = current.providers[providerId] ?? { apiKeys: [] }
      const nextSecrets: WebSearchProviderSecrets = {
        apiKeys:
          patch.apiKeys === undefined
            ? patch.preserveExisting
              ? existing.apiKeys
              : existing.apiKeys
            : normalizeSecretList(patch.apiKeys),
        basicAuthPassword:
          patch.basicAuthPassword === undefined
            ? patch.preserveExisting
              ? existing.basicAuthPassword
              : existing.basicAuthPassword
            : patch.basicAuthPassword.trim() || undefined
      }
      await save({
        providers: {
          ...current.providers,
          [providerId]: nextSecrets
        }
      })
    },
    async clearProviderSecrets(providerId) {
      const current = await load()
      const providers = { ...current.providers }
      delete providers[providerId]
      await save({ providers })
    },
    async toSafeView(providerId) {
      const secrets = await this.getProviderSecrets(providerId)
      const key = secrets.apiKeys.find((item) => item.trim().length > 0)?.trim()
      return {
        hasApiKey: Boolean(key),
        apiKeyPreview: maskSecret(key),
        apiKeyLength: key?.length ?? 0,
        hasBasicAuth: Boolean(secrets.basicAuthPassword?.trim())
      }
    }
  }
}

export function maskSecret(secret?: string): string {
  // 与模型供应商同一口径：头 4 + 10 个 `*` + 尾 4（旧的省略号格式不再产生）。
  return platformMaskSecret(secret)
}

function normalizeCredentialState(value: unknown): WebSearchCredentialState {
  if (!value || typeof value !== 'object') return { providers: {} }
  const providers = (value as Partial<WebSearchCredentialState>).providers
  if (!providers || typeof providers !== 'object') return { providers: {} }
  const normalized: WebSearchCredentialState['providers'] = {}

  for (const [providerId, secrets] of Object.entries(providers)) {
    if (!secrets || typeof secrets !== 'object') continue
    const candidate = secrets as Partial<WebSearchProviderSecrets>
    normalized[providerId as WebSearchProviderId] = {
      apiKeys: normalizeSecretList(candidate.apiKeys),
      basicAuthPassword:
        typeof candidate.basicAuthPassword === 'string' && candidate.basicAuthPassword.trim()
          ? candidate.basicAuthPassword.trim()
          : undefined
    }
  }

  return { providers: normalized }
}

function normalizeSecretList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
}
