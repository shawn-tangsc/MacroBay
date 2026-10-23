export type InputGuardCode =
  | 'invalid-input'
  | 'unexpected-property'
  | 'missing-property'
  | 'type-mismatch'
  | 'invalid-enum'
  | 'out-of-range'
  | 'string-too-long'
  | 'sensitive-input-rejected'
  | 'invalid-action-fields'

export type CapabilityInputValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: InputGuardCode; readonly message: string }

/** action value -> field names the action accepts besides `action` itself. */
export type CapabilityActionRules = Readonly<Record<string, readonly string[]>>

type Failure = Extract<CapabilityInputValidation, { ok: false }>

const DEFAULT_MAX_STRING_LENGTH = 4096
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+\S{8,}/,
  /\bBasic\s+\S{8,}/,
  /\bsk-[A-Za-z0-9]{8,}/,
  /[?#&](api[_-]?key|token|access_token|secret|signature)=/i
]

export function validateCapabilityInput(
  value: unknown,
  schema: Record<string, unknown>,
  actionRules?: CapabilityActionRules
): CapabilityInputValidation {
  if (!isPlainObject(value)) return fail('invalid-input', 'Input must be a plain object.')

  const keys = Object.getOwnPropertyNames(value)
  if (keys.some((key) => FORBIDDEN_KEYS.has(key))) {
    return fail('invalid-input', 'Input contains a forbidden object key.')
  }

  const properties = asRecord(schema.properties) ?? {}
  const declared = new Set(Object.keys(properties))
  for (const key of keys) {
    if (!declared.has(key)) return fail('unexpected-property', `Unsupported parameter: ${key}.`)
  }

  const required = Array.isArray(schema.required) ? schema.required : []
  for (const name of required) {
    if (typeof name !== 'string') continue
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      return fail('missing-property', `Missing required parameter: ${name}.`)
    }
  }

  for (const key of keys) {
    const propertySchema = asRecord(properties[key])
    if (!propertySchema) continue
    const failure = validateProperty(value[key], propertySchema, key)
    if (failure) return failure
  }

  const sensitive = scanForCredentials(value, new WeakSet())
  if (sensitive) return sensitive

  if (actionRules) {
    const action = value.action
    const allowed =
      typeof action === 'string' && Object.prototype.hasOwnProperty.call(actionRules, action)
        ? new Set(['action', ...actionRules[action]])
        : undefined
    if (!allowed) return fail('invalid-action-fields', 'Unsupported action or action fields.')
    for (const key of keys) {
      if (!allowed.has(key)) return fail('invalid-action-fields', `Action does not accept parameter: ${key}.`)
    }
  }

  return { ok: true }
}

function validateProperty(value: unknown, schema: Record<string, unknown>, name: string): Failure | undefined {
  const expectedType = schema.type
  if (typeof expectedType === 'string' && !matchesType(value, expectedType)) {
    return fail('type-mismatch', `Parameter ${name} must be of type ${expectedType}.`)
  }

  const enumValues = schema.enum
  if (Array.isArray(enumValues) && !enumValues.includes(value)) {
    return fail('invalid-enum', `Parameter ${name} has an unsupported value.`)
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return fail('out-of-range', `Parameter ${name} is below the minimum.`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return fail('out-of-range', `Parameter ${name} exceeds the maximum.`)
    }
  }

  if (typeof value === 'string') {
    const declaredLimit = schema['x-maxStringLength']
    const limit =
      typeof declaredLimit === 'number' && Number.isFinite(declaredLimit) && declaredLimit > 0
        ? declaredLimit
        : DEFAULT_MAX_STRING_LENGTH
    if (value.length > limit) return fail('string-too-long', `Parameter ${name} exceeds ${limit} characters.`)
  }

  return undefined
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return true
  }
}

function scanForCredentials(value: unknown, seen: WeakSet<object>): Failure | undefined {
  if (typeof value === 'string') {
    return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))
      ? fail('sensitive-input-rejected', 'Request contains credential-like content.')
      : undefined
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const failure = scanForCredentials(item, seen)
      if (failure) return failure
    }
    return undefined
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return undefined
    seen.add(value)
    for (const child of Object.values(value)) {
      const failure = scanForCredentials(child, seen)
      if (failure) return failure
    }
  }

  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

function fail(code: InputGuardCode, message: string): Failure {
  return { ok: false, code, message }
}
