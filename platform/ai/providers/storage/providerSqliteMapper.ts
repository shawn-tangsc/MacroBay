import type { DatabaseSync } from 'node:sqlite'

import type {
  ModelCapabilities,
  ModelDeclarationSource,
  ModelDefinition,
  ModelPricing,
  PersistedModelProvider,
  PersistedProviderState,
  ProviderCustomHeader,
  ProviderSecretOrphan,
  ProviderWebsiteLinks
} from '../modelProviderTypes'
import { normalizeModelSupportedProtocols } from '../modelChatProtocol'
import { normalizeModelAvailability } from '../modelAvailability'
import { isSystemProviderId } from '../providerPresets'
import {
  normalizeProviderChatEndpoints,
  normalizeProviderImageEndpoints,
  resolveProviderPrimaryBase
} from '../providerChatEndpoints'

/**
 * 行 ↔ 域对象的唯一映射点。
 *
 * 端点只有一份事实源：`endpoints_json`（有序，`[0]` = 默认端点）+ `image_endpoints_json`。
 * 写入与读取都直接用它，不再派生/折叠任何镜像字段。
 *
 * 不变量（有测试）：`read(write(state))` 的域对象与 `state` 逐字段相等。
 */
type ProviderRow = {
  id: string
  name: string
  enabled: number
  base_url: string
  endpoints_json: string
  removed_endpoint_protocols_json: string | null
  image_endpoints_json: string | null
  websites_json: string | null
  custom_headers_json: string | null
  default_chat_model_id: string | null
  removed_preset_model_ids_json: string
  sort_index: number
  updated_at: string
}

type ModelRow = {
  provider_id: string
  model_id: string
  name: string
  group_name: string | null
  capabilities_json: string
  chat_protocol: string | null
  supported_protocols_json: string | null
  declared_protocols_json: string | null
  probed_protocols_json: string | null
  messages_support: string | null
  responses_support: string | null
  declaration_source: string | null
  probe_status: string | null
  probe_reason: string | null
  protocol_probed_at: string | null
  availability_json: string | null
  context_length: number | null
  max_completion_tokens: number | null
  pricing_json: string | null
  preset_model: number
  preset_stale: number
  provider_declared: number
  sort_index: number
}

type SecretRow = { provider_id: string; ref: string; preview: string | null; updated_at: string }

export const providerMetaKeys = {
  /** 预设种子只允许灌一次；用户清空供应商后不得被重新灌回。 */
  seeded: 'seeded'
} as const

export function readPersistedProviderState(connection: DatabaseSync): PersistedProviderState {
  const providers = connection
    .prepare('select * from model_providers order by sort_index asc, id asc')
    .all() as unknown as ProviderRow[]
  const models = connection
    .prepare('select * from model_models order by provider_id asc, sort_index asc, model_id asc')
    .all() as unknown as ModelRow[]
  const secrets = connection
    .prepare('select * from model_provider_secrets')
    .all() as unknown as SecretRow[]
  const orphans = connection
    .prepare('select * from model_provider_secret_orphans order by created_at asc, provider_id asc, ref asc')
    .all() as unknown as Array<{ provider_id: string; ref: string }>

  const modelsByProvider = new Map<string, ModelRow[]>()
  for (const row of models) {
    const bucket = modelsByProvider.get(row.provider_id)
    if (bucket) bucket.push(row)
    else modelsByProvider.set(row.provider_id, [row])
  }
  const secretByProvider = new Map(secrets.map((row) => [row.provider_id, row]))

  return {
    providers: providers.map((row) => fromProviderRow(row, modelsByProvider.get(row.id) ?? [], secretByProvider.get(row.id))),
    ...(orphans.length > 0
      ? { secretOrphans: orphans.map((row): ProviderSecretOrphan => ({ providerId: row.provider_id, ref: row.ref })) }
      : {})
  }
}

export function writePersistedProviderState(
  connection: DatabaseSync,
  state: PersistedProviderState,
  updatedAt: string
): void {
  const existingProviders = new Map(
    (connection.prepare('select * from model_providers').all() as unknown as ProviderRow[]).map((row) => [row.id, row])
  )
  const desiredProviderIds = new Set<string>()

  state.providers.forEach((provider, index) => {
    desiredProviderIds.add(provider.id)
    const existing = existingProviders.get(provider.id)
    const row = toProviderRow(provider, index, existing?.updated_at ?? updatedAt)
    const unchanged = existing !== undefined
      && providerRowContent(existing) === providerRowContent(row)
    upsertProviderRow(connection, unchanged && existing ? { ...row, updated_at: existing.updated_at } : row)
    writeProviderModels(connection, provider)
    writeProviderSecret(connection, provider, updatedAt)
  })

  deleteMissing(connection, 'model_providers', 'id', desiredProviderIds)

  // 孤儿密钥日志最多 32 条，整表替换最简单也最不容易出错。
  connection.exec('delete from model_provider_secret_orphans')
  const insertOrphan = connection.prepare(
    'insert or ignore into model_provider_secret_orphans (provider_id, ref, created_at) values (?, ?, ?)'
  )
  for (const orphan of state.secretOrphans ?? []) {
    insertOrphan.run(orphan.providerId, orphan.ref, updatedAt)
  }
}

export function readProviderMeta<T>(connection: DatabaseSync, key: string): T | undefined {
  const row = connection
    .prepare('select value_json from model_provider_meta where key = ?')
    .get(key) as { value_json?: string } | undefined
  if (!row?.value_json) return undefined
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return undefined
  }
}

export function writeProviderMeta(connection: DatabaseSync, key: string, value: unknown, updatedAt: string): void {
  connection
    .prepare(`
      insert into model_provider_meta (key, value_json, updated_at) values (?, ?, ?)
      on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at
    `)
    .run(key, JSON.stringify(value), updatedAt)
}

export function countProviderRows(connection: DatabaseSync): number {
  const row = connection.prepare('select count(*) as total from model_providers').get() as { total?: number } | undefined
  return row?.total ?? 0
}

function fromProviderRow(row: ProviderRow, modelRows: ModelRow[], secret?: SecretRow): PersistedModelProvider {
  const endpoints = normalizeProviderChatEndpoints(parseJson<unknown>(row.endpoints_json, []))
  const imageEndpoints = normalizeProviderImageEndpoints(parseJson<unknown>(row.image_endpoints_json, null))
  const customHeaders = parseJson<ProviderCustomHeader[] | null>(row.custom_headers_json, null)
  const websites = parseJson<ProviderWebsiteLinks | null>(row.websites_json, null)
  const removedPresetModelIds = parseJson<string[]>(row.removed_preset_model_ids_json, [])
  // 端点墓碑：只保留合法协议、去重、固定顺序；null / 空 ⇒ 缺省（没有墓碑）。
  const removedEndpointProtocols = normalizeModelSupportedProtocols(
    parseJson<unknown>(row.removed_endpoint_protocols_json, null)
  )

  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    // 主地址由端点清单派生（`base_url` 只是同一次写入的可读镜像，不参与读取口径）。
    baseUrl: resolveProviderPrimaryBase({ endpoints }),
    endpoints,
    ...(removedEndpointProtocols ? { removedEndpointProtocols } : {}),
    ...(imageEndpoints ? { imageEndpoints } : {}),
    ...(customHeaders && customHeaders.length > 0 ? { customHeaders } : {}),
    ...(secret
      ? {
          apiKeyRef: secret.ref,
          ...(secret.preview ? { apiKeyPreview: secret.preview } : {}),
          apiKeyMigrationState: 'vault-backed' as const,
          apiKeyStorageVersion: 1 as const
        }
      : {}),
    isSystem: isSystemProviderId(row.id),
    ...(websites ? { websites } : {}),
    models: modelRows.map(fromModelRow),
    ...(row.default_chat_model_id !== null ? { defaultChatModelId: row.default_chat_model_id } : {}),
    ...(removedPresetModelIds.length > 0 ? { removedPresetModelIds } : {})
  }
}

function fromModelRow(row: ModelRow): ModelDefinition {
  const pricing = parseJson<ModelPricing | null>(row.pricing_json, null)
  return {
    id: row.model_id,
    name: row.name,
    ...(row.group_name !== null ? { group: row.group_name } : {}),
    provider: row.provider_id,
    capabilities: parseJson<ModelCapabilities>(row.capabilities_json, { chat: true }),
    ...(row.context_length !== null ? { contextLength: row.context_length } : {}),
    ...(row.max_completion_tokens !== null ? { maxCompletionTokens: row.max_completion_tokens } : {}),
    ...(pricing ? { pricing } : {}),
    ...(row.messages_support === 'yes' || row.messages_support === 'no' || row.messages_support === 'unknown'
      ? { messagesSupport: row.messages_support }
      : {}),
    ...(row.responses_support === 'yes' || row.responses_support === 'no' || row.responses_support === 'unknown'
      ? { responsesSupport: row.responses_support }
      : {}),
    ...(row.declaration_source === 'provider_list'
      ? { declarationSource: row.declaration_source as ModelDeclarationSource }
      : {}),
    ...(row.protocol_probed_at !== null ? { protocolProbedAt: row.protocol_probed_at } : {}),
    ...(row.probe_status === 'passed' || row.probe_status === 'failed' || row.probe_status === 'unsupported'
      ? { probeStatus: row.probe_status }
      : {}),
    ...(() => {
      const availability = normalizeModelAvailability(parseJson<unknown>(row.availability_json, null))
      return availability ? { availability } : {}
    })(),
    ...(row.probe_reason !== null ? { probeReason: row.probe_reason } : {}),
    ...(row.provider_declared === 1 ? { providerDeclared: true } : {}),
    ...(row.preset_model === 1 ? { presetModel: true } : {}),
    ...(row.preset_stale === 1 ? { presetStale: true } : {}),
    ...(row.chat_protocol !== null ? { chatProtocol: row.chat_protocol as ModelDefinition['chatProtocol'] } : {}),
    ...(() => {
      const supported = normalizeModelSupportedProtocols(parseJson<unknown>(row.supported_protocols_json, null))
      const declared = normalizeModelSupportedProtocols(parseJson<unknown>(row.declared_protocols_json, null))
      const probed = normalizeModelSupportedProtocols(parseJson<unknown>(row.probed_protocols_json, null))
      return {
        ...(supported ? { supportedProtocols: supported } : {}),
        ...(declared ? { declaredProtocols: declared } : {}),
        ...(probed ? { probedProtocols: probed } : {})
      }
    })()
  }
}

function toProviderRow(provider: PersistedModelProvider, sortIndex: number, updatedAt: string): ProviderRow {
  const removedEndpointProtocols = normalizeModelSupportedProtocols(provider.removedEndpointProtocols)
  return {
    id: provider.id,
    name: provider.name,
    enabled: provider.enabled ? 1 : 0,
    base_url: resolveProviderPrimaryBase(provider),
    endpoints_json: JSON.stringify(normalizeProviderChatEndpoints(provider.endpoints)),
    removed_endpoint_protocols_json: removedEndpointProtocols ? JSON.stringify(removedEndpointProtocols) : null,
    image_endpoints_json: provider.imageEndpoints ? JSON.stringify(provider.imageEndpoints) : null,
    websites_json: provider.websites ? JSON.stringify(provider.websites) : null,
    custom_headers_json: provider.customHeaders?.length ? JSON.stringify(provider.customHeaders) : null,
    default_chat_model_id: provider.defaultChatModelId ?? null,
    removed_preset_model_ids_json: JSON.stringify(provider.removedPresetModelIds ?? []),
    sort_index: sortIndex,
    updated_at: updatedAt
  }
}

function toModelRow(providerId: string, model: ModelDefinition, sortIndex: number): ModelRow {
  return {
    provider_id: providerId,
    model_id: model.id,
    name: model.name,
    group_name: model.group ?? null,
    capabilities_json: JSON.stringify(model.capabilities),
    chat_protocol: model.chatProtocol ?? null,
    supported_protocols_json: model.supportedProtocols?.length ? JSON.stringify(model.supportedProtocols) : null,
    declared_protocols_json: model.declaredProtocols?.length ? JSON.stringify(model.declaredProtocols) : null,
    probed_protocols_json: model.probedProtocols?.length ? JSON.stringify(model.probedProtocols) : null,
    messages_support: model.messagesSupport ?? null,
    responses_support: model.responsesSupport ?? null,
    declaration_source: model.declarationSource ?? null,
    probe_status: model.probeStatus ?? null,
    probe_reason: model.probeReason ?? null,
    protocol_probed_at: model.protocolProbedAt ?? null,
    availability_json: model.availability ? JSON.stringify(model.availability) : null,
    context_length: model.contextLength ?? null,
    max_completion_tokens: model.maxCompletionTokens ?? null,
    pricing_json: model.pricing ? JSON.stringify(model.pricing) : null,
    preset_model: model.presetModel ? 1 : 0,
    preset_stale: model.presetStale ? 1 : 0,
    provider_declared: model.providerDeclared ? 1 : 0,
    sort_index: sortIndex
  }
}

function upsertProviderRow(connection: DatabaseSync, row: ProviderRow): void {
  connection
    .prepare(`
      insert into model_providers (
        id, name, enabled, base_url, endpoints_json, removed_endpoint_protocols_json, image_endpoints_json,
        websites_json, custom_headers_json, default_chat_model_id, removed_preset_model_ids_json,
        sort_index, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        name = excluded.name,
        enabled = excluded.enabled,
        base_url = excluded.base_url,
        endpoints_json = excluded.endpoints_json,
        removed_endpoint_protocols_json = excluded.removed_endpoint_protocols_json,
        image_endpoints_json = excluded.image_endpoints_json,
        websites_json = excluded.websites_json,
        custom_headers_json = excluded.custom_headers_json,
        default_chat_model_id = excluded.default_chat_model_id,
        removed_preset_model_ids_json = excluded.removed_preset_model_ids_json,
        sort_index = excluded.sort_index,
        updated_at = excluded.updated_at
    `)
    .run(
      row.id,
      row.name,
      row.enabled,
      row.base_url,
      row.endpoints_json,
      row.removed_endpoint_protocols_json,
      row.image_endpoints_json,
      row.websites_json,
      row.custom_headers_json,
      row.default_chat_model_id,
      row.removed_preset_model_ids_json,
      row.sort_index,
      row.updated_at
    )
}

function writeProviderModels(connection: DatabaseSync, provider: PersistedModelProvider): void {
  const existing = new Map(
    (connection
      .prepare('select * from model_models where provider_id = ?')
      .all(provider.id) as unknown as ModelRow[]).map((row) => [row.model_id, row])
  )
  const desiredIds = new Set<string>()

  provider.models.forEach((model, index) => {
    desiredIds.add(model.id)
    const row = toModelRow(provider.id, model, index)
    const previous = existing.get(model.id)
    if (previous && modelRowContent(previous) === modelRowContent(row)) return
    connection
      .prepare(`
        insert into model_models (
          provider_id, model_id, name, group_name, capabilities_json, chat_protocol,
          supported_protocols_json, declared_protocols_json, probed_protocols_json,
          messages_support, responses_support, declaration_source,
          probe_status, probe_reason, protocol_probed_at, availability_json,
          context_length, max_completion_tokens,
          pricing_json, preset_model, preset_stale, provider_declared, sort_index
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(provider_id, model_id) do update set
          name = excluded.name,
          group_name = excluded.group_name,
          capabilities_json = excluded.capabilities_json,
          chat_protocol = excluded.chat_protocol,
          supported_protocols_json = excluded.supported_protocols_json,
          declared_protocols_json = excluded.declared_protocols_json,
          probed_protocols_json = excluded.probed_protocols_json,
          messages_support = excluded.messages_support,
          responses_support = excluded.responses_support,
          declaration_source = excluded.declaration_source,
          probe_status = excluded.probe_status,
          probe_reason = excluded.probe_reason,
          protocol_probed_at = excluded.protocol_probed_at,
          availability_json = excluded.availability_json,
          context_length = excluded.context_length,
          max_completion_tokens = excluded.max_completion_tokens,
          pricing_json = excluded.pricing_json,
          preset_model = excluded.preset_model,
          preset_stale = excluded.preset_stale,
          provider_declared = excluded.provider_declared,
          sort_index = excluded.sort_index
      `)
      .run(
        row.provider_id,
        row.model_id,
        row.name,
        row.group_name,
        row.capabilities_json,
        row.chat_protocol,
        row.supported_protocols_json,
        row.declared_protocols_json,
        row.probed_protocols_json,
        row.messages_support,
        row.responses_support,
        row.declaration_source,
        row.probe_status,
        row.probe_reason,
        row.protocol_probed_at,
        row.availability_json,
        row.context_length,
        row.max_completion_tokens,
        row.pricing_json,
        row.preset_model,
        row.preset_stale,
        row.provider_declared,
        row.sort_index
      )
  })

  deleteMissing(connection, 'model_models', 'model_id', desiredIds, provider.id)
}

function writeProviderSecret(connection: DatabaseSync, provider: PersistedModelProvider, updatedAt: string): void {
  if (!provider.apiKeyRef) {
    connection.prepare('delete from model_provider_secrets where provider_id = ?').run(provider.id)
    return
  }
  connection
    .prepare(`
      insert into model_provider_secrets (provider_id, ref, preview, updated_at) values (?, ?, ?, ?)
      on conflict(provider_id) do update set
        ref = excluded.ref,
        preview = excluded.preview,
        updated_at = excluded.updated_at
    `)
    .run(provider.id, provider.apiKeyRef, provider.apiKeyPreview ?? null, updatedAt)
}

function deleteMissing(
  connection: DatabaseSync,
  table: 'model_providers' | 'model_models',
  keyColumn: 'id' | 'model_id',
  desiredIds: ReadonlySet<string>,
  providerId?: string
): void {
  const scope = providerId === undefined ? '' : ' and provider_id = ?'
  const parameters: Array<string> = providerId === undefined ? [] : [providerId]
  if (desiredIds.size === 0) {
    connection.prepare(`delete from ${table} where 1 = 1${scope}`).run(...parameters)
    return
  }
  const placeholders = Array.from(desiredIds, () => '?').join(', ')
  connection
    .prepare(`delete from ${table} where ${keyColumn} not in (${placeholders})${scope}`)
    .run(...Array.from(desiredIds), ...parameters)
}

function providerRowContent(row: ProviderRow): string {
  return JSON.stringify([
    row.id, row.name, row.enabled, row.base_url, row.endpoints_json, row.removed_endpoint_protocols_json,
    row.image_endpoints_json, row.websites_json, row.custom_headers_json, row.default_chat_model_id,
    row.removed_preset_model_ids_json, row.sort_index
  ])
}

function modelRowContent(row: ModelRow): string {
  return JSON.stringify([
    row.provider_id, row.model_id, row.name, row.group_name, row.capabilities_json, row.chat_protocol,
    row.supported_protocols_json, row.declared_protocols_json, row.probed_protocols_json,
    row.messages_support, row.responses_support, row.declaration_source,
    row.probe_status, row.probe_reason, row.protocol_probed_at, row.availability_json, row.context_length,
    row.max_completion_tokens, row.pricing_json, row.preset_model, row.preset_stale, row.provider_declared,
    row.sort_index
  ])
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
