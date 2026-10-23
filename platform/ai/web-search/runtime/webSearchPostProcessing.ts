import type { WebSearchCompressionConfig, WebSearchResponse } from '../contracts/webSearchContracts'

export function applyWebSearchPostProcessing(
  response: WebSearchResponse,
  compression: WebSearchCompressionConfig
): WebSearchResponse {
  if (compression.method !== 'cutoff' || response.results.length === 0) {
    return response
  }

  const totalBefore = response.results.reduce((sum, result) => sum + result.content.length, 0)
  const perResultLimit = Math.max(1, Math.floor(compression.cutoffLimit / response.results.length))
  const results = response.results.map((result) => ({
    ...result,
    content: result.content.slice(0, perResultLimit)
  }))
  const totalAfter = results.reduce((sum, result) => sum + result.content.length, 0)

  return {
    ...response,
    results,
    status: [
      ...(response.status ?? []),
      {
        phase: 'cutoff',
        countBefore: totalBefore,
        countAfter: totalAfter
      }
    ]
  }
}
