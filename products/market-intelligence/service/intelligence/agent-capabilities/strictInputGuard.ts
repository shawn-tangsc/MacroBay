import type { ProductToolGuardCode } from './capabilityTypes'
import { containsCredentialValue, isCredentialKeyName } from './sensitivePatterns'

export type CapabilityInputValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ProductToolGuardCode; readonly message: string }

/** A per-action allow-list, optionally naming required fields or a required field group. */
export type CapabilityActionRule =
  | readonly string[]
  | Readonly<{
      fields: readonly string[]
      required?: readonly string[]
      /** At least one of these fields must be present; used to reject an empty patch. */
      anyOfRequired?: readonly string[]
    }>

/** action value -> the fields that action accepts besides `action` itself. */
export type CapabilityActionRules = Readonly<Record<string, CapabilityActionRule>>

type Failure = Extract<CapabilityInputValidation, { ok: false }>

const DEFAULT_MAX_STRING_LENGTH = 4096
const MAX_INPUT_DEPTH = 32
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Validates the whole input tree against the schema. Symbol keys are ignored;
 * own string keys are checked at every level for forbidden names, credential
 * names and credential-shaped values.
 */
export function validateCapabilityInput(
  value: unknown,
  schema: Record<string, unknown>,
  actionRules?: CapabilityActionRules
): CapabilityInputValidation {
  if (!isPlainObject(value)) return fail('invalid-input', 'Input must be a plain object.')

  const sensitive = scanForSensitiveContent(value, new WeakSet())
  if (sensitive) return sensitive

  const structureFailure = validateObject(value, schema, 0)
  if (structureFailure) return structureFailure

  if (actionRules) {
    const action = value.action
    const rule =
      typeof action === 'string' && Object.prototype.hasOwnProperty.call(actionRules, action)
        ? actionRules[action]
        : undefined
    if (!rule) return fail('invalid-action-fields', 'Unsupported action or action fields.')
    const { fields, required, anyOfRequired } = normalizeActionRule(rule)
    const allowed = new Set(['action', ...fields])
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!allowed.has(key)) return fail('invalid-action-fields', `Action does not accept parameter: ${key}.`)
    }
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) {
        return fail('missing-property', `Missing required parameter: ${name}.`)
      }
    }
    if (
      anyOfRequired.length > 0 &&
      !anyOfRequired.some((name) => Object.prototype.hasOwnProperty.call(value, name))
    ) {
      return fail(
        'invalid-action-fields',
        `Action requires at least one of: ${anyOfRequired.join(', ')}.`
      )
    }
  }

  return { ok: true }
}

function normalizeActionRule(rule: CapabilityActionRule): {
  fields: readonly string[]
  required: readonly string[]
  anyOfRequired: readonly string[]
} {
  if (Array.isArray(rule)) return { fields: rule, required: [], anyOfRequired: [] }
  const record = rule as Readonly<{
    fields: readonly string[]
    required?: readonly string[]
    anyOfRequired?: readonly string[]
  }>
  return {
    fields: record.fields,
    required: record.required ?? [],
    anyOfRequired: record.anyOfRequired ?? []
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  depth: number
): Failure | undefined {
  if (depth > MAX_INPUT_DEPTH) return fail('invalid-input', 'Input is nested too deeply.')

  const properties = asRecord(schema.properties) ?? {}
  const keys = Object.getOwnPropertyNames(value)

  if (schema.additionalProperties === false) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        return fail('unexpected-property', `Unsupported parameter: ${key}.`)
      }
    }
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
    const failure = validateValue(value[key], propertySchema, key, depth + 1)
    if (failure) return failure
  }

  return undefined
}

function validateValue(
  value: unknown,
  schema: Record<string, unknown>,
  name: string,
  depth: number
): Failure | undefined {
  if (depth > MAX_INPUT_DEPTH) return fail('invalid-input', 'Input is nested too deeply.')

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

  if (Array.isArray(value)) {
    const items = asRecord(schema.items)
    if (!items) return undefined
    for (let index = 0; index < value.length; index += 1) {
      const failure = validateValue(value[index], items, `${name}[${index}]`, depth + 1)
      if (failure) return failure
    }
    return undefined
  }

  if (isPlainObject(value)) return validateObject(value, schema, depth)

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

function scanForSensitiveContent(value: unknown, seen: WeakSet<object>): Failure | undefined {
  if (typeof value === 'string') {
    return containsCredentialValue(value)
      ? fail('sensitive-input-rejected', 'Request contains credential-like content.')
      : undefined
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined
    seen.add(value)
    for (const item of value) {
      const failure = scanForSensitiveContent(item, seen)
      if (failure) return failure
    }
    return undefined
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return undefined
    seen.add(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      if (FORBIDDEN_KEYS.has(key)) return fail('invalid-input', 'Input contains a forbidden object key.')
      if (isCredentialKeyName(key)) {
        return fail('sensitive-input-rejected', `Parameter ${key} is not an accepted input field.`)
      }
      const failure = scanForSensitiveContent(value[key], seen)
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

function fail(code: ProductToolGuardCode, message: string): Failure {
  return { ok: false, code, message }
}
