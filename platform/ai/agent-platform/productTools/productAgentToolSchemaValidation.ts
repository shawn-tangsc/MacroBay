type JsonSchema = Record<string, unknown>

export type ProductAgentToolSchemaValidationResult =
  | { ok: true }
  | { ok: false; message: string }

export function validateProductAgentToolJsonSchema(
  value: unknown,
  schema: JsonSchema
): ProductAgentToolSchemaValidationResult {
  if (schema.type === 'object' || schema.properties || schema.required) {
    return validateObjectSchema(value, schema)
  }

  return validateByType(value, schema)
}

function validateObjectSchema(value: unknown, schema: JsonSchema): ProductAgentToolSchemaValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'Expected an object value.' }
  }

  const record = value as Record<string, unknown>
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
  for (const key of required) {
    if (!(key in record)) {
      return { ok: false, message: `Missing required property "${key}".` }
    }
  }

  const properties =
    typeof schema.properties === 'object' && schema.properties !== null
      ? (schema.properties as Record<string, JsonSchema>)
      : {}

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in record)) continue
    const result = validateByType(record[key], propertySchema)
    if (!result.ok) {
      return { ok: false, message: `Property "${key}": ${result.message}` }
    }
  }

  return { ok: true }
}

function validateByType(value: unknown, schema: JsonSchema): ProductAgentToolSchemaValidationResult {
  const expectedType = typeof schema.type === 'string' ? schema.type : undefined
  if (!expectedType) return { ok: true }

  switch (expectedType) {
    case 'object':
      return validateObjectSchema(value, schema)
    case 'string':
      return typeof value === 'string' ? { ok: true } : { ok: false, message: 'Expected a string.' }
    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, message: `Expected a ${expectedType}.` }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true } : { ok: false, message: 'Expected a boolean.' }
    case 'array':
      return Array.isArray(value) ? { ok: true } : { ok: false, message: 'Expected an array.' }
    case 'null':
      return value === null ? { ok: true } : { ok: false, message: 'Expected null.' }
    default:
      return { ok: true }
  }
}
