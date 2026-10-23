/** `feishu` is a storage carrier; only this exact public preset belongs to the Lark adapter. */
export const LARK_PUBLIC_CONFIG_JSON = '{"domain":"lark"}'

/** Limits generic Channel management to accepted storage adapters and the frozen Lark preset. */
export function managedChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${column('type')} in ('telegram','slack','qq','discord') or (${column('type')}='feishu' and ${column('public_config_json')}='${LARK_PUBLIC_CONFIG_JSON}') or (${column('type')}='wechat' and ${column('public_config_json')}='{}'))`
}

/** Only Telegram has a persisted real-smoke enable path; all other adapters are blocked at this baseline. */
export function runtimeAuthorizedChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `(${managedChannelSql(alias)} and ${column('type')}='telegram')`
}

/** This list intentionally names only adapters without accepted real-smoke evidence in this release line. */
export function blockedRuntimeChannelSql(alias = ''): string {
  const column = (name: string) => alias ? `${alias}.${name}` : name
  return `${column('type')} in ('slack','feishu','qq','discord') or (${column('type')}='wechat' and ${column('public_config_json')}='{}')`
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
