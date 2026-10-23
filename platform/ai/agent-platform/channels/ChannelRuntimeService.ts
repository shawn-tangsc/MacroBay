import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { AgentStoreState } from '../store/agentStore'
import type {
  AgentChannelRuntimeHost,
  AgentChannelRuntimeCredentialState,
  AgentChannelRuntimeErrorKind,
  AgentChannelRuntimeHostContext,
  AgentChannelRuntimeHostFactory,
  AgentChannelRuntimeLifecycleState,
  AgentChannelRuntimeSessionState,
  AgentChannelRuntimeStatusUpdate
} from './channelRuntimeHost'

export type AgentChannelRuntimeState = 'connected' | 'connecting' | 'error' | 'inactive'

export type AgentChannelRuntimeSnapshotEntry = {
  channelId: string
  type: AgentChannelEntity['type']
  agentId: string | null
  sessionId: string | null
  isActive: boolean
  activeChatCount: number
  runtimeState: AgentChannelRuntimeState
  runtimeMessage?: string
  runtimeErrorKind?: AgentChannelRuntimeErrorKind
  runtimeRetryable?: boolean
  runtimeLifecycleState?: AgentChannelRuntimeLifecycleState
  credentialState?: AgentChannelRuntimeCredentialState
  credentialHint?: string
  credentialUrl?: string
  credentialQrText?: string
  credentialExpiresAt?: number
  sessionState?: AgentChannelRuntimeSessionState
  lastCheckedAt?: number
  updatedAt: number
}

export type AgentChannelRuntimeSnapshot = {
  channels: AgentChannelRuntimeSnapshotEntry[]
}

type ActiveRuntimeHost = {
  signature: string
  host: AgentChannelRuntimeHost
}

type ChannelRuntimeStatus = {
  runtimeState?: Exclude<AgentChannelRuntimeState, 'inactive'>
  runtimeMessage?: string
  runtimeErrorKind?: AgentChannelRuntimeErrorKind
  runtimeRetryable?: boolean
  runtimeLifecycleState?: AgentChannelRuntimeLifecycleState
  credentialState?: AgentChannelRuntimeCredentialState
  credentialHint?: string
  credentialUrl?: string
  credentialQrText?: string
  credentialExpiresAt?: number
  sessionState?: AgentChannelRuntimeSessionState
  lastCheckedAt?: number
  updatedAt: number
}

type GetChannelRuntimeSnapshotOptions = {
  includeDiagnostics?: boolean
}

type ChannelRuntimeServiceDependencies = {
  now?: () => number
  createChannelHost?: AgentChannelRuntimeHostFactory
  handleIncomingText?: AgentChannelRuntimeHostContext['handleIncomingText']
  persistChannelConfig?: (channelId: string, nextConfig: AgentChannelEntity['config']) => Promise<void> | void
  onSnapshotChanged?: (snapshot: AgentChannelRuntimeSnapshot) => void
}

const defaultNow = (): number => Date.now()
const pendingConnectionLifecycleStates = new Set<AgentChannelRuntimeLifecycleState>([
  'awaiting-credential',
  'awaiting-qr-scan'
])

export class ChannelRuntimeService {
  private readonly activeHostsByChannelId = new Map<string, ActiveRuntimeHost>()
  private readonly channelsByChannelId = new Map<string, AgentChannelEntity>()
  private readonly runtimeStatusByChannelId = new Map<string, ChannelRuntimeStatus>()
  private readonly runtimeStatusUnsubscribeByChannelId = new Map<string, () => void>()

  constructor(private readonly deps: ChannelRuntimeServiceDependencies = {}) {}

  getSnapshot(options: GetChannelRuntimeSnapshotOptions = {}): AgentChannelRuntimeSnapshot {
    const includeDiagnostics = options.includeDiagnostics === true
    return {
      channels: [...this.channelsByChannelId.values()]
        .map((channel) => this.createSnapshotEntry(channel, includeDiagnostics))
        .sort((a, b) => a.channelId.localeCompare(b.channelId))
    }
  }

  getHost(channelId: string): AgentChannelRuntimeHost | null {
    return this.activeHostsByChannelId.get(channelId)?.host ?? null
  }

  async syncFromState(state: AgentStoreState): Promise<AgentChannelRuntimeSnapshot> {
    const nextChannelIds = new Set(state.channels.map((channel) => channel.id))

    for (const [channelId] of [...this.activeHostsByChannelId.entries()]) {
      if (nextChannelIds.has(channelId)) continue
      await this.closeHost(channelId, { clearRuntimeStatus: true })
      this.channelsByChannelId.delete(channelId)
    }

    for (const channelId of [...this.channelsByChannelId.keys()]) {
      if (nextChannelIds.has(channelId)) continue
      this.channelsByChannelId.delete(channelId)
    }

    for (const channel of state.channels) {
      this.channelsByChannelId.set(channel.id, cloneChannel(channel))

      if (!channel.isActive) {
        await this.closeHost(channel.id, { clearRuntimeStatus: true })
        continue
      }

      const signature = buildChannelSignature(channel)
      const active = this.activeHostsByChannelId.get(channel.id)
      if (active && active.signature !== signature) {
        await this.closeHost(channel.id)
      }

      if (this.activeHostsByChannelId.has(channel.id)) continue

      await this.connectChannel(channel, signature)
    }

    const snapshot = this.getSnapshot()
    this.emitSnapshotChanged()
    return snapshot
  }

  async restartChannel(channelId: string): Promise<void> {
    const channel = this.channelsByChannelId.get(channelId)
    if (!channel?.isActive) return
    await this.closeHost(channelId)
    await this.connectChannel(channel, buildChannelSignature(channel))
  }

  async dispose(): Promise<void> {
    const channelIds = [...this.activeHostsByChannelId.keys()]
    await Promise.all(channelIds.map((channelId) => this.closeHost(channelId, { clearRuntimeStatus: true })))
    this.channelsByChannelId.clear()
    this.runtimeStatusByChannelId.clear()
    this.runtimeStatusUnsubscribeByChannelId.clear()
    this.emitSnapshotChanged()
  }

  private createSnapshotEntry(
    channel: AgentChannelEntity,
    includeDiagnostics: boolean
  ): AgentChannelRuntimeSnapshotEntry {
    if (!channel.isActive) {
      return {
        channelId: channel.id,
        type: channel.type,
        agentId: channel.agentId ?? null,
        sessionId: channel.sessionId ?? null,
        isActive: false,
        activeChatCount: channel.activeChatIds?.length ?? 0,
        runtimeState: 'inactive',
        updatedAt: (this.deps.now ?? defaultNow)()
      }
    }

    const status = this.runtimeStatusByChannelId.get(channel.id)
    const fallbackState = this.activeHostsByChannelId.has(channel.id) ? 'connected' : 'connecting'
    const runtimeState = getEffectiveRuntimeState(status, fallbackState)

    return {
      channelId: channel.id,
      type: channel.type,
      agentId: channel.agentId ?? null,
      sessionId: channel.sessionId ?? null,
      isActive: channel.isActive,
      activeChatCount: channel.activeChatIds?.length ?? 0,
      runtimeState: runtimeState ?? fallbackState,
      ...((runtimeState === 'error' || includeDiagnostics) && status?.runtimeMessage
        ? { runtimeMessage: status.runtimeMessage }
        : {}),
      ...(includeDiagnostics && status?.runtimeErrorKind
        ? { runtimeErrorKind: status.runtimeErrorKind }
        : {}),
      ...(includeDiagnostics && typeof status?.runtimeRetryable === 'boolean'
        ? { runtimeRetryable: status.runtimeRetryable }
        : {}),
      ...(includeDiagnostics && status?.runtimeLifecycleState
        ? { runtimeLifecycleState: status.runtimeLifecycleState }
        : {}),
      ...(includeDiagnostics && status?.credentialState
        ? { credentialState: status.credentialState }
        : {}),
      ...(includeDiagnostics && status?.credentialHint ? { credentialHint: status.credentialHint } : {}),
      ...(includeDiagnostics && status?.credentialUrl ? { credentialUrl: status.credentialUrl } : {}),
      ...(includeDiagnostics && status?.credentialQrText
        ? { credentialQrText: status.credentialQrText }
        : {}),
      ...(includeDiagnostics && typeof status?.credentialExpiresAt === 'number'
        ? { credentialExpiresAt: status.credentialExpiresAt }
        : {}),
      ...(includeDiagnostics && status?.sessionState ? { sessionState: status.sessionState } : {}),
      ...(includeDiagnostics && typeof status?.lastCheckedAt === 'number'
        ? { lastCheckedAt: status.lastCheckedAt }
        : {}),
      updatedAt: status?.updatedAt ?? (this.deps.now ?? defaultNow)()
    }
  }

  private async connectChannel(channel: AgentChannelEntity, signature: string): Promise<void> {
    const now = (this.deps.now ?? defaultNow)()
    const previousStatus = this.runtimeStatusByChannelId.get(channel.id)
    this.runtimeStatusByChannelId.set(
      channel.id,
      mergeRuntimeStatus(
        previousStatus,
        {
          runtimeState: 'connecting',
          lifecycleState:
            previousStatus?.runtimeLifecycleState === 'reconnecting'
              ? 'reconnecting'
              : 'connecting',
          lastCheckedAt: now
        },
        now
      )
    )

    try {
      if (!this.deps.createChannelHost) {
        throw new Error('Channel runtime host factory is not wired yet.')
      }
      const host = await this.deps.createChannelHost(cloneChannel(channel), {
        handleIncomingText: this.deps.handleIncomingText
      })
      this.registerRuntimeStatusListener(channel.id, host)
      await host.connect()
      this.activeHostsByChannelId.set(channel.id, {
        signature,
        host
      })
      this.promoteChannelConnected(channel.id)
    } catch (error) {
      this.markChannelError(channel.id, error)
      this.emitSnapshotChanged()
    }
  }

  private registerRuntimeStatusListener(
    channelId: string,
    host: AgentChannelRuntimeHost
  ): void {
    const unsubscribe = host.subscribeToRuntimeStatus?.((status) => {
      void this.handleRuntimeStatusUpdate(channelId, status)
    })
    if (typeof unsubscribe !== 'function') return
    this.runtimeStatusUnsubscribeByChannelId.set(channelId, unsubscribe)
  }

  private async handleRuntimeStatusUpdate(
    channelId: string,
    statusUpdate: AgentChannelRuntimeStatusUpdate
  ): Promise<void> {
    const channel = this.channelsByChannelId.get(channelId)
    if (!channel) return

    if (statusUpdate.nextConfig) {
      channel.config = cloneChannelConfig(statusUpdate.nextConfig)
      this.channelsByChannelId.set(channelId, cloneChannel(channel))
      try {
        await this.deps.persistChannelConfig?.(channelId, cloneChannelConfig(statusUpdate.nextConfig))
      } catch (error) {
        this.markChannelError(channelId, error)
        return
      }
    }

    const now = (this.deps.now ?? defaultNow)()
    this.runtimeStatusByChannelId.set(
      channelId,
      mergeRuntimeStatus(this.runtimeStatusByChannelId.get(channelId), statusUpdate, now)
    )

    if (statusUpdate.requestReconnect) {
      await this.restartChannel(channelId)
      return
    }
    this.emitSnapshotChanged()
  }

  private promoteChannelConnected(channelId: string): void {
    const previousStatus = this.runtimeStatusByChannelId.get(channelId)
    if (
      previousStatus?.runtimeLifecycleState &&
      pendingConnectionLifecycleStates.has(previousStatus.runtimeLifecycleState)
    ) {
      return
    }

    const now = (this.deps.now ?? defaultNow)()
    this.runtimeStatusByChannelId.set(channelId, {
      ...(previousStatus ?? { updatedAt: now }),
      runtimeState: 'connected',
      runtimeMessage: undefined,
      runtimeErrorKind: undefined,
      runtimeRetryable: undefined,
      runtimeLifecycleState: 'ready',
      lastCheckedAt: now,
      updatedAt: now
    })
    this.emitSnapshotChanged()
  }

  private markChannelError(channelId: string, error: unknown): void {
    const now = (this.deps.now ?? defaultNow)()
    const message = error instanceof Error ? error.message : String(error)
    const runtimeErrorKind = classifyChannelRuntimeError(message)
    this.runtimeStatusByChannelId.set(channelId, {
      runtimeState: 'error',
      runtimeMessage: message,
      runtimeErrorKind,
      runtimeRetryable: runtimeErrorKind === 'transient',
      runtimeLifecycleState: 'terminal-error',
      lastCheckedAt: now,
      updatedAt: now
    })
  }

  private async closeHost(
    channelId: string,
    options: { clearRuntimeStatus?: boolean } = {}
  ): Promise<void> {
    const active = this.activeHostsByChannelId.get(channelId)
    const unsubscribe = this.runtimeStatusUnsubscribeByChannelId.get(channelId)
    if (unsubscribe) {
      this.runtimeStatusUnsubscribeByChannelId.delete(channelId)
      unsubscribe()
    }
    if (options.clearRuntimeStatus) {
      this.runtimeStatusByChannelId.delete(channelId)
    }
    if (!active) return
    this.activeHostsByChannelId.delete(channelId)
    await active.host.close()
    this.emitSnapshotChanged()
  }

  private emitSnapshotChanged(): AgentChannelRuntimeSnapshot {
    const snapshot = this.getSnapshot({ includeDiagnostics: true })
    this.deps.onSnapshotChanged?.(snapshot)
    return snapshot
  }
}

function buildChannelSignature(channel: AgentChannelEntity): string {
  return JSON.stringify({
    type: channel.type,
    name: channel.name,
    agentId: channel.agentId ?? null,
    sessionId: channel.sessionId ?? null,
    workspace: channel.workspace,
    config: channel.config,
    permissionMode: channel.permissionMode ?? null,
    isActive: channel.isActive
  })
}

function cloneChannel(channel: AgentChannelEntity): AgentChannelEntity {
  return {
    ...channel,
    workspace: { ...channel.workspace },
    config: cloneChannelConfig(channel.config),
    activeChatIds: channel.activeChatIds ? [...channel.activeChatIds] : undefined
  } as AgentChannelEntity
}

function cloneChannelConfig(config: AgentChannelEntity['config']): AgentChannelEntity['config'] {
  return { ...config } as AgentChannelEntity['config']
}

function mergeRuntimeStatus(
  previous: ChannelRuntimeStatus | undefined,
  update: AgentChannelRuntimeStatusUpdate,
  now: number
): ChannelRuntimeStatus {
  const explicitLifecycleState = readOptionalField(
    update,
    'lifecycleState',
    previous?.runtimeLifecycleState
  )
  const explicitRuntimeState = readOptionalField(update, 'runtimeState', previous?.runtimeState)

  return {
    runtimeState:
      Object.prototype.hasOwnProperty.call(update, 'runtimeState') ||
      !Object.prototype.hasOwnProperty.call(update, 'lifecycleState')
        ? explicitRuntimeState
        : lifecycleStateToRuntimeState(explicitLifecycleState),
    runtimeMessage: normalizeOptionalString(readOptionalField(update, 'message', previous?.runtimeMessage)),
    runtimeErrorKind: readOptionalField(update, 'errorKind', previous?.runtimeErrorKind),
    runtimeRetryable: readOptionalField(update, 'retryable', previous?.runtimeRetryable),
    runtimeLifecycleState: explicitLifecycleState,
    credentialState: readOptionalField(update, 'credentialState', previous?.credentialState),
    credentialHint: normalizeOptionalString(readOptionalField(update, 'credentialHint', previous?.credentialHint)),
    credentialUrl: normalizeOptionalString(readOptionalField(update, 'credentialUrl', previous?.credentialUrl)),
    credentialQrText: normalizeOptionalString(
      readOptionalField(update, 'credentialQrText', previous?.credentialQrText)
    ),
    credentialExpiresAt: readOptionalField(
      update,
      'credentialExpiresAt',
      previous?.credentialExpiresAt
    ),
    sessionState: readOptionalField(update, 'sessionState', previous?.sessionState),
    lastCheckedAt: readOptionalField(update, 'lastCheckedAt', previous?.lastCheckedAt) ?? now,
    updatedAt: now
  }
}

function getEffectiveRuntimeState(
  status: ChannelRuntimeStatus | undefined,
  fallbackState: Exclude<AgentChannelRuntimeState, 'inactive'>
): Exclude<AgentChannelRuntimeState, 'inactive'> {
  if (status?.runtimeState) {
    return status.runtimeState
  }

  switch (status?.runtimeLifecycleState) {
    case 'connecting':
    case 'awaiting-credential':
    case 'awaiting-qr-scan':
    case 'reconnecting':
      return 'connecting'
    case 'session-expired':
    case 'terminal-error':
      return 'error'
    case 'ready':
      return 'connected'
    default:
    return fallbackState
  }
}

function lifecycleStateToRuntimeState(
  lifecycleState: AgentChannelRuntimeLifecycleState | undefined
): Exclude<AgentChannelRuntimeState, 'inactive'> | undefined {
  switch (lifecycleState) {
    case 'connecting':
    case 'awaiting-credential':
    case 'awaiting-qr-scan':
    case 'reconnecting':
      return 'connecting'
    case 'session-expired':
    case 'terminal-error':
      return 'error'
    case 'ready':
      return 'connected'
    default:
      return undefined
  }
}

function classifyChannelRuntimeError(message: string): AgentChannelRuntimeErrorKind {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('abort') ||
    normalized.includes('cancelled') ||
    normalized.includes('canceled')
  ) {
    return 'abort'
  }
  if (
    normalized.includes('auth') ||
    normalized.includes('token') ||
    normalized.includes('credential') ||
    normalized.includes('401') ||
    normalized.includes('403')
  ) {
    return 'auth'
  }
  if (
    normalized.includes('dependency') ||
    normalized.includes('module') ||
    normalized.includes('package') ||
    normalized.includes('adapter')
  ) {
    return 'dependency'
  }
  if (
    normalized.includes('config') ||
    normalized.includes('invalid') ||
    normalized.includes('missing')
  ) {
    return 'config'
  }
  return 'transient'
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readOptionalField<TKey extends keyof AgentChannelRuntimeStatusUpdate, TValue>(
  update: AgentChannelRuntimeStatusUpdate,
  key: TKey,
  fallback: TValue
): TValue {
  if (!Object.prototype.hasOwnProperty.call(update, key)) {
    return fallback
  }
  return (update[key] ?? undefined) as TValue
}
