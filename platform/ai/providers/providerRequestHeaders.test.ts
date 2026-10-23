import { describe, expect, it } from 'vitest'

import { mergeProviderHeaders, validateProviderHeader } from './providerRequestHeaders'

describe('provider custom headers', () => {
  it('merges custom headers after defaults and allows overriding normal headers', () => {
    expect(mergeProviderHeaders(
      { authorization: 'Bearer secret', 'content-type': 'application/json', 'user-agent': 'default' },
      [
        { name: 'X-Test', value: '1' },
        { name: 'user-agent', value: 'custom-agent' }
      ]
    )).toMatchObject({
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      'X-Test': '1',
      'user-agent': 'custom-agent'
    })
  })

  it('rejects reserved, invalid-name and newline headers', () => {
    expect(validateProviderHeader({ name: 'authorization', value: 'x' })).toBe('reserved_name')
    expect(validateProviderHeader({ name: 'bad header', value: 'x' })).toBe('invalid_name')
    expect(validateProviderHeader({ name: 'X-Test', value: 'a\nb' })).toBe('invalid_value')
    expect(validateProviderHeader({ name: 'X-Test', value: 'ok' })).toBeNull()

    expect(mergeProviderHeaders({}, [
      { name: 'authorization', value: 'override' },
      { name: 'X-Test', value: 'a\nb' }
    ])).toEqual({})
  })
})
