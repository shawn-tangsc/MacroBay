import { httpRequest, type HttpClientOptions, type HttpClientRequest } from '@platform/jobs'
import { getPlatformFetch } from '@platform/network/platformFetch'

export function intelligenceHttpRequest(
  request: HttpClientRequest,
  options: Omit<HttpClientOptions, 'fetchImpl'> = {}
) {
  return httpRequest(request, {
    ...options,
    fetchImpl: resolvePlatformFetch()
  })
}

function resolvePlatformFetch(): typeof fetch {
  try {
    return getPlatformFetch()
  } catch {
    return fetch
  }
}
