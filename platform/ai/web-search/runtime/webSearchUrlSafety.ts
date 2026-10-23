import type { WebSearchErrorCode } from '../contracts/webSearchContracts'

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; code: WebSearchErrorCode; message: string }

const maxUrlLength = 4096

export function validateWebFetchUrl(input: string): UrlSafetyResult {
  if (typeof input !== 'string' || !input.trim()) {
    return unsafe('invalid_input', 'URL is required.')
  }
  if (input.length > maxUrlLength) {
    return unsafe('unsafe_url', 'URL is too long.')
  }

  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return unsafe('invalid_input', 'URL is invalid.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return unsafe('unsafe_url', 'Only HTTP(S) URLs are allowed.')
  }
  if (url.username || url.password) {
    return unsafe('unsafe_url', 'URL credentials are not allowed.')
  }
  if (isUnsafeHostname(url.hostname)) {
    return unsafe('unsafe_url', 'URL host is not allowed.')
  }

  return { ok: true, url }
}

export async function validateRedirectTarget(input: string): Promise<UrlSafetyResult> {
  return validateWebFetchUrl(input)
}

export function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true

  const ipv4 = parseIpv4(normalized)
  if (ipv4) return isUnsafeIpv4(ipv4)

  if (normalized.includes(':')) return isUnsafeIpv6(normalized)

  return false
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return null
  }
  return octets
}

function isUnsafeIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isUnsafeIpv6(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  )
}

function unsafe(code: WebSearchErrorCode, message: string): UrlSafetyResult {
  return { ok: false, code, message }
}
