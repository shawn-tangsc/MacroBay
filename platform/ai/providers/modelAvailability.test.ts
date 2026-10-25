import { describe, expect, it } from 'vitest'

import {
  SecretVaultError,
  type SecretMetadata,
  type SecretOwnerScope,
  type SecretRef,
  type SecretVault
} from '../../secrets'
import type { ModelProvider, ProviderState } from './modelProviderTypes'
import {
  isModelAvailabilityStale,
  modelAvailabilityFingerprint,
  normalizeModelAvailability
} from './modelAvailability'
import {
  applyModelAvailability,
  createProviderStore,
  ProviderSecretMetadataPolicy
} from './providerStore'

const CHECKED_AT = '2026-10-25T05:00:00.000Z'

function providerFixture(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'provider-avail',
    name: 'Availability Provider',
    enabled: true,
    endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://relay.example.test' }],
    baseUrl: 'https://relay.example.test',
    apiKeyPreview: 'sk-a**********wxyz',
    models: [
      { id: 'model-ok', name: 'Model OK', capabilities: { chat: true } },
      { id: 'model-fail', name: 'Model Fail', capabilities: { chat: true } }
    ],
    ...overrides
  }
}

function stateFixture(): ProviderState {
  return { providers: [providerFixture()] }
}

describe('model availability fingerprint', () => {
  it('is stable for the same connection-relevant configuration', () => {
    const provider = providerFixture()
    const model = provider.models[0]
    const config = { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview }
    expect(modelAvailabilityFingerprint(config, model)).toBe(modelAvailabilityFingerprint(config, model))
  })

  it('changes when the key, an endpoint, the protocol, or the probe capability changes', () => {
    const provider = providerFixture()
    const model = provider.models[0]
    const base = modelAvailabilityFingerprint({ endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview }, model)

    expect(
      modelAvailabilityFingerprint({ endpoints: provider.endpoints, apiKeyPreview: 'sk-b**********wxyz' }, model)
    ).not.toBe(base)
    expect(
      modelAvailabilityFingerprint({
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://other.example.test' }],
        apiKeyPreview: provider.apiKeyPreview
      }, model)
    ).not.toBe(base)
    expect(
      modelAvailabilityFingerprint(
        { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview },
        { ...model, chatProtocol: 'responses' }
      )
    ).not.toBe(base)
    expect(
      modelAvailabilityFingerprint(
        { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview },
        { ...model, capabilities: { chat: false, embedding: true } }
      )
    ).not.toBe(base)
  })

  it('ignores display-only fields', () => {
    const provider = providerFixture()
    const model = provider.models[0]
    const config = { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview }
    const renamed = { ...model, name: 'Renamed' }
    expect(modelAvailabilityFingerprint(config, renamed)).toBe(modelAvailabilityFingerprint(config, model))
  })
})

describe('normalizeModelAvailability', () => {
  it('keeps a complete verdict and drops dirty values', () => {
    const value = {
      status: 'failed',
      reasonCode: 'http_401',
      checkedAt: CHECKED_AT,
      fingerprint: modelAvailabilityFingerprint(
        { endpoints: [], apiKeyPreview: '' },
        { id: 'm', capabilities: { chat: true } }
      )
    }
    expect(normalizeModelAvailability(value)).toEqual(value)
    expect(normalizeModelAvailability({ ...value, status: 'skipped' })).toBeUndefined()
    expect(normalizeModelAvailability({ ...value, checkedAt: 'not-a-date' })).toBeUndefined()
    expect(normalizeModelAvailability({ ...value, fingerprint: '' })).toBeUndefined()
    expect(normalizeModelAvailability({ ...value, reasonCode: 'HTTP 401' })).toEqual({
      status: 'failed',
      checkedAt: CHECKED_AT,
      fingerprint: value.fingerprint
    })
  })
})

describe('applyModelAvailability', () => {
  it('writes status, reason, timestamp, and the fingerprint of the current config', () => {
    const provider = providerFixture()
    const next = applyModelAvailability(
      stateFixture(),
      provider.id,
      [
        { modelId: 'model-ok', status: 'ok' },
        { modelId: 'model-fail', status: 'failed', reasonCode: 'http_401' }
      ],
      CHECKED_AT
    )

    const config = { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview }
    expect(next.providers[0].models[0].availability).toEqual({
      status: 'ok',
      checkedAt: CHECKED_AT,
      fingerprint: modelAvailabilityFingerprint(config, provider.models[0])
    })
    expect(next.providers[0].models[1].availability).toEqual({
      status: 'failed',
      reasonCode: 'http_401',
      checkedAt: CHECKED_AT,
      fingerprint: modelAvailabilityFingerprint(config, provider.models[1])
    })
  })

  it('returns the same state when nothing changed and ignores unknown models', () => {
    const state = stateFixture()
    expect(applyModelAvailability(state, 'missing-provider', [{ modelId: 'model-ok', status: 'ok' }], CHECKED_AT)).toBe(state)
    expect(applyModelAvailability(state, 'provider-avail', [], CHECKED_AT)).toBe(state)

    const once = applyModelAvailability(state, 'provider-avail', [{ modelId: 'unknown', status: 'ok' }], CHECKED_AT)
    expect(once).toBe(state)

    const written = applyModelAvailability(state, 'provider-avail', [{ modelId: 'model-ok', status: 'ok' }], CHECKED_AT)
    const twice = applyModelAvailability(written, 'provider-avail', [{ modelId: 'model-ok', status: 'ok' }], CHECKED_AT)
    expect(twice).toBe(written)
  })

  it('marks a verdict stale after the key or endpoint changes', () => {
    const provider = providerFixture()
    const written = applyModelAvailability(stateFixture(), provider.id, [{ modelId: 'model-ok', status: 'ok' }], CHECKED_AT)
    const availability = written.providers[0].models[0].availability

    expect(
      isModelAvailabilityStale(
        availability,
        { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview },
        provider.models[0]
      )
    ).toBe(false)
    expect(
      isModelAvailabilityStale(
        availability,
        { endpoints: provider.endpoints, apiKeyPreview: 'sk-new**********wxyz' },
        provider.models[0]
      )
    ).toBe(true)
    expect(
      isModelAvailabilityStale(
        availability,
        { endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://moved.example.test' }], apiKeyPreview: provider.apiKeyPreview },
        provider.models[0]
      )
    ).toBe(true)
  })
})

function createMemoryVault(): SecretVault {
  const values = new Map<SecretRef, string>()
  const metadata = (ref: SecretRef): SecretMetadata => ({
    ref,
    owner: ProviderSecretMetadataPolicy.owner as SecretOwnerScope,
    revision: 1,
    hasSecret: values.has(ref),
    preview: 'set',
    createdAt: CHECKED_AT,
    updatedAt: CHECKED_AT
  })
  return {
    async put({ ref, value }) {
      const target = ref ?? `provider:${values.size + 1}`
      if (values.has(target)) throw new SecretVaultError('secret-vault-ref-conflict')
      values.set(target, value)
      return metadata(target)
    },
    async get(ref) {
      return values.get(ref) ?? null
    },
    async rotate(ref, _owner, value) {
      values.set(ref, value)
      return metadata(ref)
    },
    async delete(ref) {
      values.delete(ref)
    },
    async exists(ref) {
      return values.has(ref)
    },
    async has(ref) {
      return values.has(ref)
    },
    async inspect(ref) {
      return values.has(ref) ? metadata(ref) : null
    }
  }
}

describe('providerStore recordModelAvailability', () => {
  it('persists the verdict and keeps the stored one when the renderer echoes models back', async () => {
    const store = createProviderStore(undefined, createMemoryVault())
    await store.upsert({
      id: 'provider-avail',
      name: 'Availability Provider',
      enabled: true,
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://relay.example.test' }],
      apiKey: 'sk-fixture-key-1234567890',
      models: [{ id: 'model-ok', name: 'Model OK', capabilities: { chat: true } }]
    })

    await store.recordModelAvailability('provider-avail', [{ modelId: 'model-ok', status: 'ok' }], CHECKED_AT)
    const [saved] = await store.list()
    const savedModel = saved.models[0]
    expect(savedModel.availability).toMatchObject({ status: 'ok', checkedAt: CHECKED_AT })

    // 渲染层把带 availability 的模型数组原样回传（改名）：服务端结论必须保留，不被输入覆盖。
    await store.upsert({
      id: 'provider-avail',
      name: 'Renamed Provider',
      enabled: true,
      models: [{
        ...savedModel,
        name: 'Renamed Model',
        availability: { status: 'failed', checkedAt: CHECKED_AT, fingerprint: 'forged' }
      }]
    })
    const [afterRename] = await store.list()
    expect(afterRename.name).toBe('Renamed Provider')
    expect(afterRename.models[0].name).toBe('Renamed Model')
    expect(afterRename.models[0].availability).toEqual(savedModel.availability)
  })

  it('keeps the verdict on model edit and makes it stale after a key change', async () => {
    const store = createProviderStore(undefined, createMemoryVault())
    await store.upsert({
      id: 'provider-avail',
      name: 'Availability Provider',
      enabled: true,
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://relay.example.test' }],
      apiKey: 'sk-fixture-key-1234567890',
      models: [{ id: 'model-ok', name: 'Model OK', capabilities: { chat: true }, contextLength: 8192 }]
    })
    await store.recordModelAvailability('provider-avail', [{ modelId: 'model-ok', status: 'ok' }], CHECKED_AT)

    await store.addOrUpdateModel('provider-avail', {
      id: 'model-ok',
      name: 'Model OK',
      capabilities: { chat: true },
      contextLength: 32768
    })
    const [edited] = await store.list()
    expect(edited.models[0].availability?.status).toBe('ok')
    expect(
      isModelAvailabilityStale(
        edited.models[0].availability,
        { endpoints: edited.endpoints, apiKeyPreview: edited.apiKeyPreview },
        edited.models[0]
      )
    ).toBe(false)

    await store.upsert({ id: 'provider-avail', name: 'Availability Provider', enabled: true, apiKey: 'sk-rotated-key-0987654321' })
    const [rotated] = await store.list()
    expect(rotated.models[0].availability?.status).toBe('ok')
    expect(
      isModelAvailabilityStale(
        rotated.models[0].availability,
        { endpoints: rotated.endpoints, apiKeyPreview: rotated.apiKeyPreview },
        rotated.models[0]
      )
    ).toBe(true)
  })
})
