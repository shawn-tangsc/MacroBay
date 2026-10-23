import { sanitizeSafeView } from '../schema/intelligenceSourcesContracts'
import { ProductToolGuardError } from './capabilityTypes'

const MAX_DEPTH = 32

/** Full-key, case-insensitive. No substring matching and no bare `credential`. */
const BLOCKED_KEYS = new Set([
  'apikey',
  'api_key',
  'clientsecret',
  'accesstoken',
  'authtoken',
  'refreshtoken',
  'sessiontoken',
  'bearertoken',
  'password',
  'authorization',
  'set-cookie',
  'cookie',
  'privatekey',
  'credentialdraft',
  'headers',
  'requestheaders',
  'responseheaders',
  'rawbody',
  'rawpayload',
  'rawrecords',
  'rawresponse',
  'ciphertext'
])

const STRIPPED_KEYS = new Set([
  'credentialref',
  'maskedpreview',
  'sourcespecificconfigjson',
  'localpath',
  'filepath'
])

const PATH_PREFIX = /^(?:[A-Za-z]:\\|\/(?:Users|home|var|private|tmp)\/)/
const BEARER_TOKEN = /\bBearer\s+\S{8,}/g
const BASIC_TOKEN = /\bBasic\s+\S{8,}/g
const SECRET_KEY = /\bsk-[A-Za-z0-9]{8,}/g
const SECRET_QUERY_PARAM = /([?#&](?:api[_-]?key|token|access_token|secret|signature|sig)=)[^&#\s]*/gi

/**
 * Returns a sanitised deep clone. Blocking is all-or-nothing: a blocked key
 * fails the whole call instead of returning a partial payload.
 */
export function guardProductToolOutput<T>(value: T): T {
  // Existing product helper runs first; it rejects some secret-shaped strings.
  try {
    sanitizeSafeView(value as Record<string, unknown>)
  } catch {
    throw new ProductToolGuardError('sensitive-output-blocked', 'Tool output contained sensitive content and was blocked.')
  }

  return walk(value, 0) as T
}

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    throw new ProductToolGuardError('output-too-deep', 'Tool output is nested too deeply.')
  }

  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  const clone: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (BLOCKED_KEYS.has(normalizedKey)) {
      throw new ProductToolGuardError('sensitive-output-blocked', 'Tool output contained sensitive content and was blocked.')
    }
    if (STRIPPED_KEYS.has(normalizedKey)) continue
    Object.defineProperty(clone, key, {
      value: walk(child, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return clone
}

function redactString(value: string): string {
  if (PATH_PREFIX.test(value)) return '<path>'

  return value
    .replace(BEARER_TOKEN, '<redacted>')
    .replace(BASIC_TOKEN, '<redacted>')
    .replace(SECRET_KEY, '<redacted>')
    .replace(SECRET_QUERY_PARAM, '$1<redacted>')
}
