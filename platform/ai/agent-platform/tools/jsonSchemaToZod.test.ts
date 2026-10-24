import { describe, expect, it } from 'vitest'

import { jsonSchemaToZod } from './jsonSchemaToZod'

describe('jsonSchemaToZod', () => {
  it('accepts a valid object and rejects unknown properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      required: ['symbol'],
      properties: { symbol: { type: 'string' } },
      additionalProperties: false
    })

    expect(schema.safeParse({ symbol: 'BTC' }).success).toBe(true)
    expect(schema.safeParse({ symbol: 'BTC', extra: 1 }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('keeps optional properties optional and validates nested objects and arrays', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        label: { type: 'string' },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' }, count: { type: 'integer' } }
          }
        }
      },
      additionalProperties: false
    })

    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ rows: [{ id: 'a', count: 2 }] }).success).toBe(true)
    expect(schema.safeParse({ rows: [{ id: 'a', count: 2.5 }] }).success).toBe(false)
    expect(schema.safeParse({ rows: [{}] }).success).toBe(false)
  })

  it('maps enums, nullables, and unknown constructs', () => {
    const enumSchema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] })
    expect(enumSchema.safeParse('a').success).toBe(true)
    expect(enumSchema.safeParse('c').success).toBe(false)

    const nullable = jsonSchemaToZod({ type: ['string', 'null'] })
    expect(nullable.safeParse(null).success).toBe(true)
    expect(nullable.safeParse('x').success).toBe(true)

    expect(jsonSchemaToZod({}).safeParse({ anything: true }).success).toBe(true)
    expect(jsonSchemaToZod(undefined).safeParse('x').success).toBe(true)
  })
})
