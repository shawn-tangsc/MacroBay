import { describe, expect, it } from 'vitest'

import { checkBypassRules, normalizeBypassRules } from './proxyBypassRules'

describe('checkBypassRules', () => {
  it('accepts the supported syntax and lowercases it', () => {
    expect(checkBypassRules('LOCALHOST,*.Example.test,<local>')).toEqual({
      ok: true,
      rules: ['localhost', '*.example.test', '<local>']
    })
  })

  it('rejects ports, CIDR ranges and unknown directives so saving cannot silently ignore them', () => {
    expect(checkBypassRules('10.0.0.0/8')).toEqual({ ok: false, unsupported: ['10.0.0.0/8'] })
    expect(checkBypassRules('proxy.test:8080')).toEqual({ ok: false, unsupported: ['proxy.test:8080'] })
    expect(checkBypassRules('<-loopback>')).toEqual({ ok: false, unsupported: ['<-loopback>'] })
  })
})

describe('normalizeBypassRules', () => {
  it('splits legacy semicolons, drops residue, and keeps IPv6 literals', () => {
    expect(normalizeBypassRules('localhost;127.0.0.1;:1;::1;api.bls.gov')).toBe('localhost,127.0.0.1,::1,api.bls.gov')
    expect(checkBypassRules('localhost;127.0.0.1;:1;::1;api.bls.gov')).toEqual({
      ok: true,
      rules: ['localhost', '127.0.0.1', '::1', 'api.bls.gov']
    })
  })

  it('still rejects syntax it cannot honour', () => {
    expect(checkBypassRules('localhost;10.0.0.0/8')).toMatchObject({ ok: false })
    expect(checkBypassRules('[::1]:8080')).toMatchObject({ ok: false })
  })
})
