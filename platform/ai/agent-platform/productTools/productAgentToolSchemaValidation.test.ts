import { describe, expect, it } from 'vitest'

import { validateProductAgentToolJsonSchema } from './productAgentToolSchemaValidation'

describe('validateProductAgentToolJsonSchema', () => {
  it('rejects missing required fields', () => {
    expect(
      validateProductAgentToolJsonSchema({}, {
        type: 'object',
        required: ['asOf'],
        properties: { asOf: { type: 'string' } }
      })
    ).toEqual({ ok: false, message: 'Missing required property "asOf".' })
  })

  it('accepts valid object payloads', () => {
    expect(
      validateProductAgentToolJsonSchema(
        { asOf: '2026-01-02T02:00:00.000Z', limit: 10 },
        {
          type: 'object',
          required: ['asOf'],
          properties: {
            asOf: { type: 'string' },
            limit: { type: 'number' }
          }
        }
      )
    ).toEqual({ ok: true })
  })
})
