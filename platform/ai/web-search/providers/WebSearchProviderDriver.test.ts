import { describe, expect, it } from 'vitest'

import { createWebSearchError, getWebSearchErrorCode, WebSearchError } from '../runtime/webSearchErrors'

describe('web search provider driver errors', () => {
  it('normalizes platform web search errors', () => {
    const error = createWebSearchError('provider_http_error', 'Provider failed.')

    expect(error).toBeInstanceOf(WebSearchError)
    expect(getWebSearchErrorCode(error)).toBe('provider_http_error')
  })

  it('maps abort exceptions to the abort error code', () => {
    expect(getWebSearchErrorCode(new DOMException('Aborted', 'AbortError'))).toBe('abort')
  })
})
