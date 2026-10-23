import { describe, expect, it } from 'vitest'

import { validateRedirectTarget, validateWebFetchUrl } from './webSearchUrlSafety'

describe('web search URL safety', () => {
  it('accepts normal HTTP and HTTPS URLs', () => {
    expect(validateWebFetchUrl('https://example.com/path?q=1')).toMatchObject({
      ok: true,
      url: new URL('https://example.com/path?q=1')
    })
  })

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'https://user:pass@example.com',
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.1.1',
    'http://224.0.0.1',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/'
  ])('rejects unsafe URL %s', (url) => {
    expect(validateWebFetchUrl(url)).toMatchObject({ ok: false })
  })

  it('validates redirect targets through the same safety rules', async () => {
    await expect(validateRedirectTarget('http://127.0.0.1/redirected')).resolves.toMatchObject({
      ok: false,
      code: 'unsafe_url'
    })
  })
})
