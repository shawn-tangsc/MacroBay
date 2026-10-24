/** `feishu` is a storage carrier; only this exact public preset belongs to the Lark adapter. */
export const LARK_PUBLIC_CONFIG_JSON = '{"domain":"lark"}'

export const channelAdapterKeys = ['telegram', 'slack', 'lark', 'qq', 'discord', 'wechat'] as const
export type ChannelAdapterKey = (typeof channelAdapterKeys)[number]

/** Limits generic Channel management to accepted storage adapters and the frozen Lark preset. */
export function managedChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${column('type')} in ('telegram','slack','qq','discord') or (${column('type')}='feishu' and ${column('public_config_json')}='${LARK_PUBLIC_CONFIG_JSON}') or (${column('type')}='wechat' and ${column('public_config_json')}='{}'))`
}

/** The runtime identity of a stored carrier row: the `feishu` carrier is the Lark adapter. */
export function channelAdapterKeyForType(type: string): ChannelAdapterKey {
  if (type === 'feishu') return 'lark'
  if ((channelAdapterKeys as readonly string[]).includes(type)) return type as ChannelAdapterKey
  throw new Error('channel-adapter-key-invalid')
}

/** SQL expression mapping a `type` column to its adapter key. */
export function adapterKeySql(column: string): string {
  return `(case when ${column} = 'feishu' then 'lark' else ${column} end)`
}

/**
 * The single runtime authorization gate. Every inbound, delivery, lifecycle and provider-state
 * query must use this predicate instead of naming an adapter.
 */
export function supportedChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${managedChannelSql(alias)} and exists (
    select 1 from channel_adapter_support s
    where s.adapter_key = ${adapterKeySql(column('type'))} and s.status = 'supported'
  ))`
}

/** Managed rows whose adapter is not currently supported; startup/quit must fence them. */
export function blockedRuntimeChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${managedChannelSql(alias)} and not exists (
    select 1 from channel_adapter_support s
    where s.adapter_key = ${adapterKeySql(column('type'))} and s.status = 'supported'
  ))`
}

export function qqChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `${column('type')}='qq'`
}

export function discordChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `${column('type')}='discord'`
}

/** New Release F metadata is distinct from legacy token_path records, which remain quarantined. */
export function wechatChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${column('type')}='wechat' and ${column('public_config_json')}='{}')`
}

/** Historic token_path and malformed WeChat rows are permanently isolated from the new QR carrier. */
export function isolatedWechatSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${column('type')}='wechat' and ${column('public_config_json')} is not '{}')`
}

/** Lark runtime state must never attach to an arbitrary historic Feishu row. */
export function larkChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${column('type')}='feishu' and ${column('public_config_json')}='${LARK_PUBLIC_CONFIG_JSON}')`
}

/** Historic Feishu rows must be fenced, not merely hidden, when they appear runtime-capable. */
export function isolatedFeishuSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${column('type')}='feishu' and ${column('public_config_json')} is not '${LARK_PUBLIC_CONFIG_JSON}')`
}

export function isLarkPublicConfig(value: unknown): boolean {
  return value === LARK_PUBLIC_CONFIG_JSON
}
