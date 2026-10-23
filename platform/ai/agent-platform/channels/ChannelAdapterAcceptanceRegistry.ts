import { agentChannelTypes, type AgentChannelType } from '../schemas/channelSchemas'

import {
  channelOptionalCapabilities,
  type ChannelAdapterAcceptanceEntry,
  type ChannelCapabilities
} from './channelContracts'

const noCapabilities: ChannelCapabilities = {
  receiveText: false,
  receiveImages: false,
  receiveFiles: false,
  sendText: false,
  streaming: false,
  typingIndicator: false,
  nativeCommands: false,
  groupMention: false,
  qrEnrollment: false,
  reconnect: false
}

export function createInitialChannelAdapterAcceptanceEntries(): ChannelAdapterAcceptanceEntry[] {
  return agentChannelTypes.map((adapterType) => ({
    adapterType,
    adapterVersion: 'unverified',
    status: adapterType === 'telegram' ? 'planned' : 'blocked',
    capabilities: { ...noCapabilities },
    receiveSmokeAt: null,
    sendSmokeAt: null,
    reconnectSmokeAt: null,
    restartRecoveryAt: null,
    proxySmokeAt: null,
    credentialRotationAt: null,
    disableDeleteFencingAt: null,
    capabilityEvidence: {}
  }))
}

export class ChannelAdapterAcceptanceRegistry {
  private readonly entriesByAdapterType = new Map<AgentChannelType, ChannelAdapterAcceptanceEntry>()

  constructor(entries: readonly ChannelAdapterAcceptanceEntry[] = []) {
    this.reset(entries)
  }

  /** Evidence reloads must discard a previously supported in-memory entry before loading current pointers. */
  reset(entries: readonly ChannelAdapterAcceptanceEntry[] = []): void {
    this.entriesByAdapterType.clear()
    for (const entry of [...createInitialChannelAdapterAcceptanceEntries(), ...entries]) this.upsert(entry)
  }

  list(): ChannelAdapterAcceptanceEntry[] {
    return agentChannelTypes
      .map((adapterType) => this.entriesByAdapterType.get(adapterType))
      .filter((entry): entry is ChannelAdapterAcceptanceEntry => Boolean(entry))
      .map(cloneEntry)
  }

  get(adapterType: AgentChannelType): ChannelAdapterAcceptanceEntry | null {
    const entry = this.entriesByAdapterType.get(adapterType)
    return entry ? cloneEntry(entry) : null
  }

  getRequired(adapterType: AgentChannelType): ChannelAdapterAcceptanceEntry {
    const entry = this.get(adapterType)
    if (!entry) {
      throw new Error(`Channel adapter acceptance is not registered for type "${adapterType}".`)
    }
    return entry
  }

  canEnable(adapterType: AgentChannelType): boolean {
    const entry = this.entriesByAdapterType.get(adapterType)
    return Boolean(entry && entry.status === 'supported' && hasRequiredEvidence(entry))
  }

  upsert(entry: ChannelAdapterAcceptanceEntry): void {
    if (entry.status === 'supported') {
      assertSupportedEvidence(entry)
    }
    this.entriesByAdapterType.set(entry.adapterType, cloneEntry(entry))
  }
}

function assertSupportedEvidence(entry: ChannelAdapterAcceptanceEntry): void {
  for (const capability of ['receiveText', 'sendText', 'reconnect'] as const) {
    if (!entry.capabilities[capability]) {
      throw new Error(
        `Channel adapter "${entry.adapterType}" cannot be marked supported without ${capability} capability.`
      )
    }
  }

  for (const field of [
    'receiveSmokeAt',
    'sendSmokeAt',
    'reconnectSmokeAt',
    'restartRecoveryAt',
    'proxySmokeAt',
    'credentialRotationAt',
    'disableDeleteFencingAt'
  ] as const) {
    if (!entry[field]) {
      throw new Error(`Channel adapter "${entry.adapterType}" cannot be marked supported without ${field}.`)
    }
  }

  for (const capability of channelOptionalCapabilities) {
    if (entry.capabilities[capability] && !entry.capabilityEvidence[capability]) {
      throw new Error(
        `Channel adapter "${entry.adapterType}" cannot be marked supported without ${capability} evidence.`
      )
    }
  }
}

function hasRequiredEvidence(entry: ChannelAdapterAcceptanceEntry): boolean {
  try {
    assertSupportedEvidence(entry)
    return true
  } catch {
    return false
  }
}

function cloneEntry(entry: ChannelAdapterAcceptanceEntry): ChannelAdapterAcceptanceEntry {
  return {
    ...entry,
    capabilities: { ...entry.capabilities },
    capabilityEvidence: { ...entry.capabilityEvidence }
  }
}
