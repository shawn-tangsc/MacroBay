/**
 * One vocabulary for credential-shaped keys and values, shared by the input
 * and output guards so the two can never drift apart.
 */

/**
 * Lowercased key names that always count as credentials, at any depth. The
 * input guard rejects them even when the schema declares them; the output
 * guard blocks the whole payload.
 */
export const CREDENTIAL_KEY_NAMES: ReadonlySet<string> = new Set([
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
  'credential',
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

/** Projection-only keys the output guard drops instead of failing the call. */
export const STRIPPED_OUTPUT_KEY_NAMES: ReadonlySet<string> = new Set([
  'credentialref',
  'maskedpreview',
  'sourcespecificconfigjson',
  'localpath',
  'filepath'
])

const URL_PARAM_NAMES = 'api[_-]?key|token|access_token|secret|signature|sig'

export const BEARER_TOKEN = /\bBearer\s+\S{8,}/g
export const BASIC_TOKEN = /\bBasic\s+\S{8,}/g
export const SECRET_KEY = /\bsk-[A-Za-z0-9]{8,}/g
/** Matches the whole `sig=...`/`secret=...` value so redaction can replace it. */
export const SECRET_URL_PARAM = new RegExp(`([?#&](?:${URL_PARAM_NAMES})=)[^&#\\s]*`, 'gi')
/** Detection-only form of the same parameter list. */
export const SECRET_URL_PARAM_MARKER = new RegExp(`[?#&](?:${URL_PARAM_NAMES})=`, 'i')

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  BEARER_TOKEN,
  BASIC_TOKEN,
  SECRET_KEY,
  SECRET_URL_PARAM_MARKER
]

/** True when a string carries a credential shape anywhere. Stateless. */
export function containsCredentialValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => value.search(pattern) >= 0)
}

/** Replaces every credential shape found in a string. */
export function redactCredentialValue(value: string): string {
  return value
    .replace(BEARER_TOKEN, '<redacted>')
    .replace(BASIC_TOKEN, '<redacted>')
    .replace(SECRET_KEY, '<redacted>')
    .replace(SECRET_URL_PARAM, '$1<redacted>')
}

export function isCredentialKeyName(key: string): boolean {
  return CREDENTIAL_KEY_NAMES.has(key.toLowerCase())
}
