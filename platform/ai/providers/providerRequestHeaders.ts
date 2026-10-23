import type { ProviderCustomHeader } from './modelProviderTypes'

/** 不允许用户覆盖的头（鉴权/主机/长度），大小写不敏感。 */
export const RESERVED_PROVIDER_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'host',
  'content-length'
])

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export type ProviderHeaderValidationError = 'invalid_name' | 'invalid_value' | 'reserved_name'

export function validateProviderHeader(
  header: Pick<ProviderCustomHeader, 'name' | 'value'>
): ProviderHeaderValidationError | null {
  const name = header.name.trim()
  if (!HEADER_NAME_PATTERN.test(name)) return 'invalid_name'
  if (RESERVED_PROVIDER_HEADERS.has(name.toLowerCase())) return 'reserved_name'
  if (/[\r\n]/.test(header.value)) return 'invalid_value'
  return null
}

/** 默认头 → 自定义头；保留用户覆盖普通头，拒绝保留头与非法头。 */
export function mergeProviderHeaders(
  defaults: Record<string, string>,
  customHeaders?: readonly ProviderCustomHeader[]
): Record<string, string> {
  const merged: Record<string, string> = { ...defaults }
  for (const header of customHeaders ?? []) {
    if (validateProviderHeader(header) !== null) continue
    merged[header.name.trim()] = header.value
  }
  return merged
}
