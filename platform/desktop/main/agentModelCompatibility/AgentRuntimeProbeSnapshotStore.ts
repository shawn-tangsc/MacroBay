import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  buildProviderRuntimeCheckReportKey,
  isGatewayDependentRuntimeCheckReport,
  isProviderRuntimeCheckReportStale,
  normalizeProviderRuntimeCheckReport,
  type ProviderRuntimeCheckReport
} from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { AgentRuntimeId } from '../../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'

export type AgentRuntimeProbeSnapshotStoreDependencies = {
  userDataPath: string
  now?: () => Date
  readFile?: (path: string, encoding: 'utf8') => Promise<string>
  writeFile?: (path: string, contents: string) => Promise<void>
  mkdir?: (path: string, options?: { recursive: boolean }) => Promise<string | undefined>
}

type PersistedAgentRuntimeProbeState = {
  version?: number
  reports: ProviderRuntimeCheckReport[]
}

/**
 * Bump whenever the compatibility rules change in a way that can alter a stored verdict.
 * Older files are dropped on load so a 429/gateway verdict from the previous rule set cannot
 * outlive the fix or keep a Messages model hidden in the agent picker.
 */
const RUNTIME_COMPATIBILITY_POLICY_VERSION = 2

export class AgentRuntimeProbeSnapshotStore {
  private memory = new Map<string, ProviderRuntimeCheckReport>()
  private loaded = false
  private readonly filePath: string

  constructor(private readonly deps: AgentRuntimeProbeSnapshotStoreDependencies) {
    this.filePath = join(deps.userDataPath, 'platform', 'agent-runtime-compatibility.json')
  }

  async getReport(
    providerId: string,
    modelId: string,
    runtimeId: AgentRuntimeId
  ): Promise<ProviderRuntimeCheckReport | null> {
    await this.ensureLoaded()
    return this.memory.get(buildProviderRuntimeCheckReportKey(providerId, modelId, runtimeId)) ?? null
  }

  async listReports(): Promise<ProviderRuntimeCheckReport[]> {
    await this.ensureLoaded()
    return [...this.memory.values()]
  }

  async writeReport(report: ProviderRuntimeCheckReport): Promise<ProviderRuntimeCheckReport> {
    await this.ensureLoaded()
    const normalized = normalizeProviderRuntimeCheckReport(report)
    if (!normalized) {
      throw new Error('Cannot persist an invalid provider runtime check report.')
    }
    const key = buildProviderRuntimeCheckReportKey(
      normalized.providerId,
      normalized.modelId,
      normalized.runtimeId
    )
    this.memory.set(key, normalized)
    await this.persist()
    return normalized
  }

  async invalidateProvider(providerId: string): Promise<void> {
    await this.ensureLoaded()
    let changed = false
    for (const [key, report] of this.memory.entries()) {
      if (report.providerId === providerId) {
        this.memory.delete(key)
        changed = true
      }
    }
    if (changed) await this.persist()
  }

  async invalidateSignatureMismatch(providerId: string, modelId: string, signature: string): Promise<void> {
    await this.ensureLoaded()
    const keyPrefix = `${providerId}:${modelId}:`
    let changed = false
    for (const [key, report] of this.memory.entries()) {
      if (!key.startsWith(keyPrefix)) continue
      if (isProviderRuntimeCheckReportStale(report, { signature, now: this.deps.now?.() })) {
        this.memory.delete(key)
        changed = true
      }
    }
    if (changed) await this.persist()
  }

  async invalidateGatewayDependentReports(): Promise<void> {
    await this.ensureLoaded()
    let changed = false
    for (const [key, report] of this.memory.entries()) {
      if (!isGatewayDependentRuntimeCheckReport(report)) continue
      this.memory.delete(key)
      changed = true
    }
    if (changed) await this.persist()
  }

  async clear(): Promise<void> {
    this.memory.clear()
    this.loaded = true
    await this.persist()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const readFileImpl = this.deps.readFile ?? ((path: string, encoding: 'utf8') => readFile(path, encoding))
      const raw = await readFileImpl(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedAgentRuntimeProbeState
      if (parsed.version !== RUNTIME_COMPATIBILITY_POLICY_VERSION) {
        this.memory.clear()
        return
      }
      const reports = Array.isArray(parsed.reports) ? parsed.reports : []
      for (const entry of reports) {
        const normalized = normalizeProviderRuntimeCheckReport(entry)
        if (!normalized) continue
        this.memory.set(
          buildProviderRuntimeCheckReportKey(
            normalized.providerId,
            normalized.modelId,
            normalized.runtimeId
          ),
          normalized
        )
      }
    } catch {
      this.memory.clear()
    }
  }

  private async persist(): Promise<void> {
    const mkdirImpl = this.deps.mkdir ?? mkdir
    const writeFileImpl = this.deps.writeFile ?? writeFile
    await mkdirImpl(dirname(this.filePath), { recursive: true })
    const payload: PersistedAgentRuntimeProbeState = {
      version: RUNTIME_COMPATIBILITY_POLICY_VERSION,
      reports: [...this.memory.values()]
    }
    await writeFileImpl(this.filePath, `${JSON.stringify(payload, null, 2)}\n`)
  }
}

export function createAgentRuntimeProbeSnapshotStore(
  deps: AgentRuntimeProbeSnapshotStoreDependencies
): AgentRuntimeProbeSnapshotStore {
  return new AgentRuntimeProbeSnapshotStore(deps)
}
