import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type IntelligenceCredentialRecord = {
  credentialRef: string
  sourceId: string
  apiKey: string
  createdAt: string
  updatedAt: string
}

export type SafeIntelligenceCredentialView = {
  credentialRef: string
  hasCredential: boolean
  maskedPreview?: string
  lastValidatedAt?: string
}

export type IntelligenceCredentialState = {
  credentials: IntelligenceCredentialRecord[]
  updatedAt: string
}

export type IntelligenceCredentialStorage = {
  read: () => Promise<IntelligenceCredentialState | null>
  write: (state: IntelligenceCredentialState) => Promise<void>
}

export type IntelligenceCredentialStore = {
  save: (input: { credentialRef: string; sourceId: string; apiKey: string }) => Promise<IntelligenceCredentialRecord>
  getByRef: (credentialRef: string) => Promise<IntelligenceCredentialRecord | null>
  deleteByRef: (credentialRef: string) => Promise<void>
  getSafeView: (credentialRef: string, lastValidatedAt?: string) => Promise<SafeIntelligenceCredentialView>
}

export function defaultIntelligenceCredentialRef(sourceId: string): string {
  return `${sourceId}-credentials`
}

export function createDefaultIntelligenceCredentialState(): IntelligenceCredentialState {
  return { credentials: [], updatedAt: new Date().toISOString() }
}

export function createInMemoryIntelligenceCredentialStorage(
  initial: IntelligenceCredentialRecord[] = []
): IntelligenceCredentialStorage {
  let credentials = [...initial]
  return {
    async read() {
      return { credentials: [...credentials], updatedAt: new Date().toISOString() }
    },
    async write(state) {
      credentials = [...state.credentials]
    }
  }
}

export function createIntelligenceCredentialStore(storage: IntelligenceCredentialStorage): IntelligenceCredentialStore {
  let cached: IntelligenceCredentialState | null = null

  async function load(): Promise<IntelligenceCredentialState> {
    if (cached) return cached
    const persisted = await storage.read()
    cached = persisted ?? createDefaultIntelligenceCredentialState()
    return cached
  }

  async function persist(state: IntelligenceCredentialState): Promise<void> {
    cached = { ...state, updatedAt: new Date().toISOString() }
    await storage.write(cached)
  }

  return {
    async save(input) {
      const state = await load()
      const now = new Date().toISOString()
      const existing = state.credentials.find((entry) => entry.credentialRef === input.credentialRef)
      const record: IntelligenceCredentialRecord = {
        credentialRef: input.credentialRef,
        sourceId: input.sourceId,
        apiKey: input.apiKey.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }

      const credentials = existing
        ? state.credentials.map((entry) => (entry.credentialRef === input.credentialRef ? record : entry))
        : [...state.credentials, record]

      await persist({ ...state, credentials })
      return record
    },
    async getByRef(credentialRef) {
      const state = await load()
      return state.credentials.find((entry) => entry.credentialRef === credentialRef) ?? null
    },
    async deleteByRef(credentialRef) {
      const state = await load()
      await persist({
        ...state,
        credentials: state.credentials.filter((entry) => entry.credentialRef !== credentialRef)
      })
    },
    async getSafeView(credentialRef, lastValidatedAt) {
      const record = await this.getByRef(credentialRef)
      return buildSafeCredentialView(credentialRef, record, lastValidatedAt)
    }
  }
}

export function buildSafeCredentialView(
  credentialRef: string,
  record: IntelligenceCredentialRecord | null,
  lastValidatedAt?: string
): SafeIntelligenceCredentialView {
  return {
    credentialRef,
    hasCredential: Boolean(record?.apiKey),
    maskedPreview: record ? maskCredential(record.apiKey) : undefined,
    lastValidatedAt: lastValidatedAt ?? record?.updatedAt
  }
}

export function createIntelligenceCredentialJsonStorage(filePath: string): IntelligenceCredentialStorage {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as IntelligenceCredentialState
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    },
    async write(value) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }
  }
}

function maskCredential(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '****'
  return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
