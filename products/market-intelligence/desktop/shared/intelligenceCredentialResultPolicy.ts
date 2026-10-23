/**
 * The two Dashboard/Settings credential surfaces read the same two result families:
 *
 * - the state family a provider with a stored key answers with
 *   (`{ sourceId, state: 'unverified' | 'succeeded' | 'failed', failureCode? }`), and
 * - the generic safe credential-test result
 *   (`{ sourceId, ok, message, testedAt }`).
 *
 * Both are re-checked here by exact own-field shape and value, so a foreign, extended, accessor or
 * non-data payload still fails closed instead of being read as a success.
 */
export function isAcceptedCredentialSave(value: unknown, sourceId: string): boolean {
  try {
    if (!isPlainDataObject(value) || sourceId.length === 0) return false
    if (hasExactOwnFields(value, ['sourceId', 'state'])) {
      return ownValue(value, 'sourceId') === sourceId && ownValue(value, 'state') === 'unverified'
    }
    return isSafeCredentialTestResult(value, sourceId) && ownValue(value, 'ok') === true
  } catch {
    return false
  }
}

export function isAcceptedConnectionResult(value: unknown, sourceId: string, credentialedProvider: boolean): boolean {
  try {
    if (!isPlainDataObject(value)) return false
    if (!credentialedProvider) {
      return hasExactOwnFields(value, ['state']) && ownValue(value, 'state') === 'succeeded'
    }
    if (hasExactOwnFields(value, ['sourceId', 'state'])) {
      return ownValue(value, 'sourceId') === sourceId && ownValue(value, 'state') === 'succeeded'
    }
    return isSafeCredentialTestResult(value, sourceId) && ownValue(value, 'ok') === true
  } catch {
    return false
  }
}

function isSafeCredentialTestResult(value: object, sourceId: string): boolean {
  return hasExactOwnFields(value, ['sourceId', 'ok', 'message', 'testedAt']) &&
    ownValue(value, 'sourceId') === sourceId &&
    typeof ownValue(value, 'ok') === 'boolean' &&
    typeof ownValue(value, 'message') === 'string' &&
    typeof ownValue(value, 'testedAt') === 'string'
}

function isPlainDataObject(value: unknown): value is object {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0)
}

function ownValue(value: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function hasExactOwnFields(value: object, fields: readonly string[]): boolean {
  const names = Object.getOwnPropertyNames(value)
  return names.length === fields.length && fields.every((field) => names.includes(field))
}
