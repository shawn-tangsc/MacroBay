import type {
  WebSearchResponse,
  WebSearchResult,
  WebSearchRunOptions
} from '../contracts/webSearchContracts'
import type { WebSearchService } from '../runtime/WebSearchService'

export const assistantWebSearchToolNames = ['web_search', 'web_fetch'] as const
export type AssistantWebSearchToolName = (typeof assistantWebSearchToolNames)[number]

export type AssistantWebSearchModelSource = {
  id: number
  title: string
  url: string
  content: string
}

export type AssistantWebSearchToolCallResult = {
  name: AssistantWebSearchToolName
  ok: boolean
  output: AssistantWebSearchModelSource[]
  response?: WebSearchResponse
  error?: string
}

export const assistantWebSearchTools = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search the web for current information, recent events, live data, uncertain facts, or source-backed verification. Do not use for historical as-of replay evidence.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            description: 'Current web search query.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_fetch',
      description:
        'Fetch readable content from known HTTP(S) web page URLs. Use after URLs are known; do not use it for broad topic discovery.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 10
          }
        },
        required: ['urls']
      }
    }
  }
] as const

export type AssistantWebSearchToolService = {
  execute: (
    call: { name: string; argumentsJson: string },
    options?: WebSearchRunOptions
  ) => Promise<AssistantWebSearchToolCallResult>
}

export function createAssistantWebSearchToolService(service: WebSearchService): AssistantWebSearchToolService {
  return {
    async execute(call, options) {
      try {
        if (call.name === 'web_search') {
          const query = parseSearchQuery(call.argumentsJson)
          const response = await service.searchKeywords({ keywords: [query] }, options)
          return {
            name: 'web_search',
            ok: true,
            output: toModelSources(response.results),
            response: response.query ? response : { ...response, query }
          }
        }

        if (call.name === 'web_fetch') {
          const urls = parseFetchUrls(call.argumentsJson)
          const response = await service.fetchUrls({ urls }, options)
          return {
            name: 'web_fetch',
            ok: true,
            output: toModelSources(response.results),
            response
          }
        }

        return {
          name: call.name as AssistantWebSearchToolName,
          ok: false,
          output: [],
          error: `Unsupported web search tool: ${call.name}`
        }
      } catch (error) {
        return {
          name: call.name as AssistantWebSearchToolName,
          ok: false,
          output: [],
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}

export function toModelSources(results: WebSearchResult[]): AssistantWebSearchModelSource[] {
  return results.map((result, index) => ({
    id: index + 1,
    title: result.title,
    url: result.url,
    content: result.content
  }))
}

function parseSearchQuery(argumentsJson: string): string {
  const input = parseObject(argumentsJson)
  if (typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('web_search requires a query string.')
  }
  return input.query.trim()
}

function parseFetchUrls(argumentsJson: string): string[] {
  const input = parseObject(argumentsJson)
  if (!Array.isArray(input.urls) || input.urls.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('web_fetch requires one or more URL strings.')
  }
  return input.urls.map((item) => item.trim())
}

function parseObject(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be an object.')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid tool arguments.')
  }
}
