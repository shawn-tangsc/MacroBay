import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelAdapterEvidenceRepository } from './ChannelAdapterEvidenceRepository'
import type { ChannelAdapterAcceptanceEntry } from './channelContracts'

describe('ChannelAdapterEvidenceRepository', () => {
  it('keeps Telegram planned unless a restricted main-process complete smoke record is persisted', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const evidence = new ChannelAdapterEvidenceRepository(database)
    const registry = new ChannelAdapterAcceptanceRegistry()
    evidence.load(registry)
    expect(registry.canEnable('telegram')).toBe(false)
    expect(() => evidence.recordSuccessfulSmoke({ entry: supported(), actor: '', realSmokeAt: '2026-07-19T00:00:00.000Z' })).toThrow('channel-evidence-invalid')
    expect(() => evidence.recordSuccessfulSmoke({ entry: supported(), actor: 'release-a-smoke', realSmokeAt: 'not-a-smoke' })).toThrow('channel-evidence-invalid')
    evidence.recordSuccessfulSmoke({ entry: supported(), actor: 'release-a-smoke', realSmokeAt: '2026-07-19T00:00:00.000Z' })
    const restarted = new ChannelAdapterAcceptanceRegistry()
    evidence.load(restarted)
    expect(restarted.canEnable('telegram')).toBe(true)
    expect(JSON.stringify(database.connection.prepare('select evidence_json from channel_adapter_acceptance_evidence_versions').get())).not.toMatch(/bot[_-]?token|api[_-]?key|"(token|secret|credential|providerPayload)"\s*:/i)
  })

  it('loads only the current version and never lets superseded evidence re-enable an adapter', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const evidence = new ChannelAdapterEvidenceRepository(database)
    evidence.recordSuccessfulSmoke({ entry: supported('release-a'), actor: 'smoke', realSmokeAt: '2026-07-19T00:00:00.000Z' })
    evidence.recordSuccessfulSmoke({ entry: supported('release-b'), actor: 'smoke', realSmokeAt: '2026-07-20T00:00:00.000Z' })
    database.connection.prepare("update channel_adapter_acceptance_evidence_versions set evidence_json='{}' where adapter_version='release-b'").run()
    const restarted = new ChannelAdapterAcceptanceRegistry()
    evidence.load(restarted)
    expect(restarted.canEnable('telegram')).toBe(false)
    expect(database.connection.prepare("select superseded_at from channel_adapter_acceptance_evidence_versions where adapter_version='release-a'").get()).toMatchObject({ superseded_at: expect.any(String) })
  })

  it('rejects an attempt to requalify a superseded or revoked version', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const evidence = new ChannelAdapterEvidenceRepository(database)
    evidence.recordSuccessfulSmoke({ entry: supported('release-a'), actor: 'smoke', realSmokeAt: '2026-07-19T00:00:00.000Z' })
    evidence.recordSuccessfulSmoke({ entry: supported('release-b'), actor: 'smoke', realSmokeAt: '2026-07-20T00:00:00.000Z' })
    expect(() => evidence.recordSuccessfulSmoke({ entry: supported('release-a'), actor: 'smoke', realSmokeAt: '2026-07-21T00:00:00.000Z' })).toThrow('channel-evidence-version-retired')
    evidence.revokeCurrent('telegram')
    expect(() => evidence.recordSuccessfulSmoke({ entry: supported('release-b'), actor: 'smoke', realSmokeAt: '2026-07-21T00:00:00.000Z' })).toThrow('channel-evidence-version-retired')
  })

  it('resets an existing registry to fail closed when its current evidence is revoked', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const evidence = new ChannelAdapterEvidenceRepository(database)
    evidence.recordSuccessfulSmoke({ entry: supported(), actor: 'smoke', realSmokeAt: '2026-07-19T00:00:00.000Z' })
    const registry = new ChannelAdapterAcceptanceRegistry()
    evidence.load(registry)
    expect(registry.canEnable('telegram')).toBe(true)

    evidence.revokeCurrent('telegram')
    evidence.load(registry)
    expect(registry.canEnable('telegram')).toBe(false)
  })

  it('does not backfill a revoked current record from the legacy one-row source after restart', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const evidence = new ChannelAdapterEvidenceRepository(database)
    evidence.recordSuccessfulSmoke({ entry: supported(), actor: 'smoke', realSmokeAt: '2026-07-19T00:00:00.000Z' })
    database.connection.prepare(
      'insert into channel_adapter_acceptance_evidence(adapter_type,evidence_json,recorded_at,recorded_by) values(?,?,?,?)'
    ).run('telegram', JSON.stringify({ entry: supported(), realSmokeAt: '2026-07-19T00:00:00.000Z' }), '2026-07-19T00:00:00.000Z', 'legacy')
    evidence.revokeCurrent('telegram')

    const restarted = new ChannelAdapterAcceptanceRegistry()
    evidence.load(restarted)
    expect(restarted.canEnable('telegram')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_adapter_acceptance_current where adapter_type=?').get('telegram')).toEqual({ count: 0 })
  })

  it('fails closed for a legacy row that lacks the full evidence contract', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const incomplete = { ...supported(), sendSmokeAt: null }
    database.connection.prepare(
      'insert into channel_adapter_acceptance_evidence(adapter_type,evidence_json,recorded_at,recorded_by) values(?,?,?,?)'
    ).run('telegram', JSON.stringify({ entry: incomplete, realSmokeAt: '2026-07-19T00:00:00.000Z' }), '2026-07-19T00:00:00.000Z', 'legacy')

    const registry = new ChannelAdapterAcceptanceRegistry()
    new ChannelAdapterEvidenceRepository(database).load(registry)
    expect(registry.canEnable('telegram')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_adapter_acceptance_current').get()).toEqual({ count: 0 })
  })
})

function supported(adapterVersion = 'release-a'): ChannelAdapterAcceptanceEntry {
  return {
    adapterType: 'telegram', adapterVersion, status: 'supported',
    capabilities: { receiveText: true, receiveImages: true, receiveFiles: true, sendText: true, streaming: false, typingIndicator: true, nativeCommands: true, groupMention: true, qrEnrollment: false, reconnect: true },
    receiveSmokeAt: '2026-07-19T00:00:00.000Z', sendSmokeAt: '2026-07-19T00:00:00.000Z', reconnectSmokeAt: '2026-07-19T00:00:00.000Z', restartRecoveryAt: '2026-07-19T00:00:00.000Z', proxySmokeAt: '2026-07-19T00:00:00.000Z', credentialRotationAt: '2026-07-19T00:00:00.000Z', disableDeleteFencingAt: '2026-07-19T00:00:00.000Z',
    capabilityEvidence: { receiveImages: 'local-automated', receiveFiles: 'local-automated', typingIndicator: 'local-automated', nativeCommands: 'local-automated', groupMention: 'local-automated' }
  }
}
