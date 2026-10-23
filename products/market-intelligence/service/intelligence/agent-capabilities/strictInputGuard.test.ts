import { describe, expect, it } from 'vitest'

import { validateCapabilityInput } from './strictInputGuard'

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    asOf: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    ratio: { type: 'number' },
    mode: { type: 'string', enum: ['summary', 'detail'] },
    flags: { type: 'array' },
    nested: { type: 'object' },
    verbose: { type: 'boolean' },
    note: { type: 'string' },
    body: { type: 'string', 'x-maxStringLength': 12 }
  },
  required: ['asOf']
}

const validInput = () => ({
  asOf: '2026-07-08T10:00:00.000Z',
  limit: 10,
  mode: 'summary',
  flags: ['a'],
  nested: { x: 1 },
  verbose: true
})

describe('validateCapabilityInput', () => {
  it('accepts a value that matches the schema', () => {
    expect(validateCapabilityInput(validInput(), schema)).toEqual({ ok: true })
  })

  it.each([null, undefined, 'text', 42, [], new Date()])('rejects a non-plain-object value: %s', (value) => {
    expect(validateCapabilityInput(value, schema)).toMatchObject({ ok: false, code: 'invalid-input' })
  })

  it('rejects an own __proto__ key', () => {
    const value = JSON.parse('{"asOf":"x","__proto__":{"polluted":true}}')
    expect(validateCapabilityInput(value, schema)).toMatchObject({ ok: false, code: 'invalid-input' })
  })

  it('rejects own prototype and constructor keys', () => {
    expect(validateCapabilityInput(JSON.parse('{"asOf":"x","prototype":{}}'), schema)).toMatchObject({
      ok: false,
      code: 'invalid-input'
    })
    expect(validateCapabilityInput(JSON.parse('{"asOf":"x","constructor":{}}'), schema)).toMatchObject({
      ok: false,
      code: 'invalid-input'
    })
  })

  it('rejects a property the schema does not declare', () => {
    expect(validateCapabilityInput({ ...validInput(), surprise: true }, schema)).toMatchObject({
      ok: false,
      code: 'unexpected-property'
    })
  })

  it('rejects a missing required property', () => {
    expect(validateCapabilityInput({ limit: 1 }, schema)).toMatchObject({
      ok: false,
      code: 'missing-property'
    })
  })

  it('rejects values whose type does not match', () => {
    expect(validateCapabilityInput({ asOf: 1 }, schema)).toMatchObject({ ok: false, code: 'type-mismatch' })
    expect(validateCapabilityInput({ asOf: 'x', limit: 1.5 }, schema)).toMatchObject({
      ok: false,
      code: 'type-mismatch'
    })
    expect(validateCapabilityInput({ asOf: 'x', flags: 'no' }, schema)).toMatchObject({
      ok: false,
      code: 'type-mismatch'
    })
    expect(validateCapabilityInput({ asOf: 'x', verbose: 'yes' }, schema)).toMatchObject({
      ok: false,
      code: 'type-mismatch'
    })
  })

  it('rejects a value outside the declared enum', () => {
    expect(validateCapabilityInput({ asOf: 'x', mode: 'full' }, schema)).toMatchObject({
      ok: false,
      code: 'invalid-enum'
    })
  })

  it('rejects numbers outside minimum and maximum', () => {
    expect(validateCapabilityInput({ asOf: 'x', limit: 0 }, schema)).toMatchObject({
      ok: false,
      code: 'out-of-range'
    })
    expect(validateCapabilityInput({ asOf: 'x', limit: 51 }, schema)).toMatchObject({
      ok: false,
      code: 'out-of-range'
    })
  })

  it('caps strings at 4096 characters unless x-maxStringLength is declared', () => {
    expect(validateCapabilityInput({ asOf: 'x'.repeat(4096) }, schema)).toEqual({ ok: true })
    expect(validateCapabilityInput({ asOf: 'x'.repeat(4097) }, schema)).toMatchObject({
      ok: false,
      code: 'string-too-long'
    })
    expect(validateCapabilityInput({ asOf: 'x', body: 'x'.repeat(12) }, schema)).toEqual({ ok: true })
    expect(validateCapabilityInput({ asOf: 'x', body: 'x'.repeat(13) }, schema)).toMatchObject({
      ok: false,
      code: 'string-too-long'
    })
  })

  it.each([
    'Bearer abcdefgh123',
    'Basic dXNlcjpwYXNz',
    'sk-abcdefgh1234',
    'https://example.test/data?api_key=abcdefgh',
    'https://example.test/data#access_token=abcdefgh'
  ])('rejects credential shapes: %s', (note) => {
    expect(validateCapabilityInput({ asOf: 'x', note }, schema)).toMatchObject({
      ok: false,
      code: 'sensitive-input-rejected'
    })
  })

  it('scans nested arrays and objects for credential shapes', () => {
    expect(validateCapabilityInput({ asOf: 'x', flags: ['Bearer abcdefgh123'] }, schema)).toMatchObject({
      ok: false,
      code: 'sensitive-input-rejected'
    })
    expect(
      validateCapabilityInput({ asOf: 'x', nested: { deeper: ['sk-abcdefgh1234'] } }, schema)
    ).toMatchObject({ ok: false, code: 'sensitive-input-rejected' })
  })

  it('does not echo the offending value in the message', () => {
    const result = validateCapabilityInput({ asOf: 'x', note: 'Bearer abcdefgh123' }, schema)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).not.toContain('abcdefgh123')
  })
})

describe('validateCapabilityInput with action rules', () => {
  const writeSchema = {
    type: 'object',
    properties: {
      action: { type: 'string' },
      sourceId: { type: 'string' },
      enabled: { type: 'boolean' },
      focusMarkets: { type: 'array' }
    },
    required: ['action']
  }

  const actionRules = {
    'set-enabled': ['sourceId', 'enabled'],
    'save-focus-markets': ['focusMarkets']
  } as const

  it('accepts a declared action with only its allowed fields', () => {
    expect(
      validateCapabilityInput({ action: 'set-enabled', sourceId: 'source-a', enabled: true }, writeSchema, actionRules)
    ).toEqual({ ok: true })
  })

  it('rejects an action that is not declared', () => {
    expect(validateCapabilityInput({ action: 'drop-everything' }, writeSchema, actionRules)).toMatchObject({
      ok: false,
      code: 'invalid-action-fields'
    })
  })

  it('rejects a field that belongs to a different action', () => {
    expect(
      validateCapabilityInput({ action: 'set-enabled', focusMarkets: ['CN'] }, writeSchema, actionRules)
    ).toMatchObject({ ok: false, code: 'invalid-action-fields' })
  })

  it('enforces per-action required fields when a rule declares them', () => {
    const rules = {
      'set-enabled': { fields: ['sourceId', 'enabled'], required: ['sourceId', 'enabled'] }
    } as const

    expect(validateCapabilityInput({ action: 'set-enabled' }, writeSchema, rules)).toMatchObject({
      ok: false,
      code: 'missing-property'
    })
    expect(
      validateCapabilityInput({ action: 'set-enabled', sourceId: 'source-a', enabled: true }, writeSchema, rules)
    ).toEqual({ ok: true })
  })
})

describe('validateCapabilityInput recursively', () => {
  const nestedSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      asOf: { type: 'string' },
      window: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['from']
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symbol: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 5 }
          },
          required: ['symbol']
        }
      }
    },
    required: ['asOf']
  }

  it('accepts a nested value that matches every level', () => {
    expect(
      validateCapabilityInput(
        { asOf: 'x', window: { from: 'a', to: 'b' }, rows: [{ symbol: 'BTCUSDT', limit: 5 }] },
        nestedSchema
      )
    ).toEqual({ ok: true })
  })

  it('rejects an undeclared key in a nested object', () => {
    expect(
      validateCapabilityInput({ asOf: 'x', window: { from: 'a', surprise: true } }, nestedSchema)
    ).toMatchObject({ ok: false, code: 'unexpected-property' })
  })

  it('rejects a missing required key in a nested object', () => {
    expect(validateCapabilityInput({ asOf: 'x', window: { to: 'b' } }, nestedSchema)).toMatchObject({
      ok: false,
      code: 'missing-property'
    })
  })

  it('rejects an undeclared key inside an array item', () => {
    expect(
      validateCapabilityInput({ asOf: 'x', rows: [{ symbol: 'BTCUSDT', surprise: true }] }, nestedSchema)
    ).toMatchObject({ ok: false, code: 'unexpected-property' })
  })

  it('rejects an invalid array item against items', () => {
    expect(validateCapabilityInput({ asOf: 'x', rows: [{ symbol: 'BTCUSDT', limit: 9 }] }, nestedSchema)).toMatchObject(
      { ok: false, code: 'out-of-range' }
    )
    expect(validateCapabilityInput({ asOf: 'x', rows: [{ limit: 1 }] }, nestedSchema)).toMatchObject({
      ok: false,
      code: 'missing-property'
    })
  })

  it('rejects a nested forbidden object key', () => {
    const value = JSON.parse('{"asOf":"x","window":{"from":"a","__proto__":{"polluted":true}}}')
    expect(validateCapabilityInput(value, nestedSchema)).toMatchObject({ ok: false, code: 'invalid-input' })
  })
})

describe('validateCapabilityInput credential names', () => {
  const credentialSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      asOf: { type: 'string' },
      apiKey: { type: 'string' },
      headers: { type: 'object' }
    },
    required: ['asOf']
  }

  it.each(['apiKey', 'headers'])('rejects the declared credential key %s', (key) => {
    expect(validateCapabilityInput({ asOf: 'x', [key]: 'value' }, credentialSchema)).toMatchObject({
      ok: false,
      code: 'sensitive-input-rejected'
    })
  })

  it('rejects a nested credential key even without a matching schema property', () => {
    expect(
      validateCapabilityInput({ asOf: 'x', nested: { password: 'value' } }, {
        type: 'object',
        properties: { asOf: { type: 'string' }, nested: { type: 'object' } }
      })
    ).toMatchObject({ ok: false, code: 'sensitive-input-rejected' })
  })

  it('rejects sig and secret URL parameters anywhere', () => {
    expect(
      validateCapabilityInput({ asOf: 'x', note: 'https://example.test/data?sig=abcdefgh' }, schema)
    ).toMatchObject({ ok: false, code: 'sensitive-input-rejected' })
    expect(
      validateCapabilityInput({ asOf: 'x', note: 'https://example.test/data?secret=abcdefgh' }, schema)
    ).toMatchObject({ ok: false, code: 'sensitive-input-rejected' })
  })
})
