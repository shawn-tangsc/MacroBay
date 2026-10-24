import { z } from 'zod'

/**
 * Converts the JSON Schema subset the product manifests use into the Zod shape the Claude Agent SDK
 * requires for in-process MCP tools.
 *
 * The SDK's `createSdkMcpServer` re-validates every tool schema and rejects plain JSON Schema
 * objects, so passing manifest schemas straight through fails at session start. Conversion keeps a
 * single source of truth: products keep declaring JSON Schema, and this adapter renders it.
 *
 * Unknown constructs degrade to permissive schemas rather than throwing; the runtime guards still
 * validate the actual call arguments.
 */
export function jsonSchemaToZod(schema: unknown, depth = 0): z.ZodType {
  if (depth > 12 || !isRecord(schema)) return z.any()

  const type = schema.type
  if (Array.isArray(type)) {
    const variants = type.filter(isString).map((entry) => jsonSchemaToZod({ ...schema, type: entry }, depth + 1))
    return variants.length > 0 ? z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]) : z.any()
  }

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const raw = (Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf) as unknown[]
    const variants = raw.map((entry) => jsonSchemaToZod(entry, depth + 1))
    return variants.length > 0 ? z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]) : z.any()
  }

  switch (type) {
    case 'object':
      return objectSchema(schema, depth)
    case 'array':
      return z.array(jsonSchemaToZod(schema.items, depth + 1))
    case 'string':
      return stringSchema(schema)
    case 'integer':
      return numberSchema(schema).int()
    case 'number':
      return numberSchema(schema)
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    default: {
      const values = enumValues(schema)
      if (values) return z.literal(values as [string, ...string[]])
      return z.any()
    }
  }
}

function objectSchema(schema: Record<string, unknown>, depth: number): z.ZodType {
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  if (!properties) return z.record(z.string(), z.unknown())

  const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : [])
  const shape: Record<string, z.ZodType> = {}
  for (const [key, value] of Object.entries(properties)) {
    const property = jsonSchemaToZod(value, depth + 1)
    shape[key] = required.has(key) ? property : property.optional()
  }

  // JSON Schema defaults to allowing extra properties; only `additionalProperties: false` makes the
  // schema strict. Unknown keys are stripped otherwise, which keeps the SDK from rejecting calls the
  // manifest never forbade.
  if (schema.additionalProperties === false) return z.object(shape).strict()
  if (schema.additionalProperties === true) return z.object(shape).loose()
  return z.object(shape)
}

function stringSchema(schema: Record<string, unknown>): z.ZodType {
  const values = enumValues(schema)
  if (values) return z.enum(values as [string, ...string[]])
  let result = z.string()
  if (typeof schema.minLength === 'number') result = result.min(schema.minLength)
  if (typeof schema.maxLength === 'number') result = result.max(schema.maxLength)
  return result
}

function numberSchema(schema: Record<string, unknown>): z.ZodNumber {
  let result = z.number()
  if (typeof schema.minimum === 'number') result = result.min(schema.minimum)
  if (typeof schema.maximum === 'number') result = result.max(schema.maximum)
  return result
}

function enumValues(schema: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(schema.enum)) return undefined
  const values = schema.enum.filter(isString)
  return values.length === schema.enum.length && values.length > 0 ? values : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
