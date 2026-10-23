import { readUpstreamFailureDetails } from '../providerFailureBody'
import { buildHttpDetail, classifyHttpFailure, type ProviderConnectionFailureCode } from '../providerFailureMapping'
import type { ModelChatProtocol, ModelDefinition, ModelProvider } from '../modelProviderTypes'
import { mergeProviderHeaders } from '../providerRequestHeaders'
import { readPath } from './remoteModelFields'
import type { ModelListEnrichment, ModelListShape } from './modelListShape'
import { normalizeRemoteModels } from './remoteModelNormalize'
import { resolveProviderChatBase } from '../providerChatEndpoints'
import { providerProtocolDeclarationOf } from '../providerPresets'

/**
 * PLAT-77：请求层。只做"怎么把列表拿回来"：URL、鉴权、翻页、信封、失败归类。
 * 字段语义一律交给 `remoteModelNormalize`。
 */

export const GEMINI_MODELS_PATH = '/v1beta/models'

const INVALID_BASE_URL_MESSAGE = 'The provider API address is invalid.'
const MISSING_BASE_URL_MESSAGE = 'The provider API address is missing.'
const MISSING_API_KEY_MESSAGE = 'Set an API key before syncing models.'
const UNREADABLE_LIST_MESSAGE = 'The provider returned an unreadable model list.'
/** 补充源失败时加在消息前，让"主列表成功但元数据源失败"一眼可辨。 */
const ENRICHMENT_FAILURE_PREFIX = 'Metadata enrichment failed: '

/** OpenAI 兼容的模型列表 URL（版本段探测与旧实现逐字一致）。 */
export function buildModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  // Google Gemini 的 OpenAI 兼容前缀是 `/v1beta/openai`。
  if (/\/openai$/i.test(trimmed)) return `${trimmed}/models`
  if (/\/v\d+(?:$|\/)/i.test(trimmed)) return `${trimmed}/models`
  return `${trimmed}/v1/models`
}

/** Gemini 原生主机：`gemini` 端点优先，去掉结尾的版本段。 */
export function resolveGeminiHost(provider: Pick<ModelProvider, 'baseUrl' | 'endpoints'>): string {
  const raw = resolveProviderChatBase(provider, 'gemini') ?? provider.baseUrl.trim()
  return raw.replace(/\/+$/, '').replace(/\/v\d+(?:beta|alpha)?$/i, '')
}

export function buildGeminiModelsUrl(host: string): string {
  return `${host}${GEMINI_MODELS_PATH}`
}

/**
 * 补充源的主机根：**去掉 `provider.baseUrl` 的路径**，只保留 origin。
 *
 * 为什么不能直接拼 baseUrl：百炼的 baseUrl 是
 * `https://dashscope.aliyuncs.com/compatible-mode/v1`，而原生列表在
 * `https://dashscope.aliyuncs.com/api/v1/models` —— 两者只有主机相同。
 * 因此 `ModelListEnrichment.path` 定义为**主机根相对路径**。
 */
export function resolveEnrichmentHost(baseUrl: string): string | undefined {
  try {
    const origin = new URL(baseUrl.trim()).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/** 补充源某页的 URL：origin + enrichment.path + 整数页码参数。 */
export function buildEnrichmentPageUrl(
  baseUrl: string,
  enrichment: ModelListEnrichment,
  page: number
): string | undefined {
  const host = resolveEnrichmentHost(baseUrl)
  if (host === undefined) return undefined
  const path = enrichment.path.startsWith('/') ? enrichment.path : `/${enrichment.path}`
  const { pageParam, sizeParam, size } = enrichment.pages
  return `${host}${path}?${encodeURIComponent(pageParam)}=${page}&${encodeURIComponent(sizeParam)}=${size}`
}

/**
 * `shape.listPath` 的 URL：**origin + listPath**（origin 取 `provider.baseUrl`）。
 *
 * 与补充源同一套 origin 规则（`resolveEnrichmentHost`）：富列表在主机根，和 chat base 的
 * 版本段/路径无关（如 aihubmix 的 baseUrl 是 `https://aihubmix.com`，富列表在 `/api/v1/models`）。
 */
export function buildListPathUrl(baseUrl: string, listPath: string): string | undefined {
  const origin = resolveEnrichmentHost(baseUrl)
  if (origin === undefined) return undefined
  const path = listPath.startsWith('/') ? listPath : `/${listPath}`
  return `${origin}${path}`
}

export type ModelListFailureReasonCode = ProviderConnectionFailureCode | 'invalid_base_url'

export class ModelListRequestError extends Error {
  constructor(
    readonly reasonCode: ModelListFailureReasonCode,
    message: string,
    readonly upstreamMessage?: string
  ) {
    super(message)
    this.name = 'ModelListRequestError'
  }
}

export type ListRemoteModelsOptions = {
  /** 必填：生产注入 Electron `net.fetch`（跟随 session 代理）；禁止回退到全局 fetch。 */
  fetch: typeof fetch
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * 主列表 URL：显式 `listPath` 优先（origin + listPath），否则沿用版本段推导。
 *
 * 导出用于诊断与「55 家预设 URL 不变」的回归断言；`listRemoteModels` 走的就是它。
 */
export function buildModelListUrl(provider: ModelProvider, shape: ModelListShape): string {
  const host = shape.envelope === 'models' ? resolveGeminiHost(provider) : provider.baseUrl.trim()
  // 显式 listPath 优先：列表在主机根，不走 baseUrl 的版本段探测。
  if (shape.listPath !== undefined) {
    const url = buildListPathUrl(provider.baseUrl, shape.listPath)
    // baseUrl 在进入这里之前已校验过是 http(s) URL；这里只是防御不可解析的残值。
    if (url === undefined) throw new ModelListRequestError('invalid_base_url', INVALID_BASE_URL_MESSAGE)
    return url
  }
  if (shape.envelope === 'models') {
    return buildGeminiModelsUrl(shape.auth === 'x-goog-api-key' ? resolveGeminiHost(provider) : host)
  }
  return buildModelsUrl(host)
}

function buildRequestHeaders(provider: ModelProvider, shape: ModelListShape, apiKey: string): Record<string, string> {
  if (shape.auth === 'x-goog-api-key') {
    // Gemini 不合并自定义头：凭据头必须完全由这里决定。
    return { 'x-goog-api-key': apiKey, accept: 'application/json' }
  }
  return mergeProviderHeaders(
    {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    provider.customHeaders
  )
}

function extractItems(payload: unknown, shape: ModelListShape): readonly unknown[] | null {
  if (payload === null || typeof payload !== 'object') return null
  const list = (payload as Record<string, unknown>)[shape.envelope]
  return Array.isArray(list) ? list : null
}

function nextPageToken(payload: unknown, shape: ModelListShape): string | undefined {
  if (shape.nextTokenPath === null) return undefined
  const token = readPath(payload, shape.nextTokenPath)
  return typeof token === 'string' && token.trim() ? token.trim() : undefined
}

/** 主列表与补充源共用的单次请求：同一个 fetch 注入、同一套鉴权头、同一套失败归类。 */
async function requestJson(
  url: string,
  headers: Record<string, string>,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const response = await fetchImpl(url, { method: 'GET', headers })
  if (!response.ok) {
    const upstream = await readUpstreamFailureDetails(response, apiKey)
    throw new ModelListRequestError(
      classifyHttpFailure(response.status, upstream.message, upstream.hints),
      buildHttpDetail(response.status, upstream.message),
      upstream.message ?? undefined
    )
  }
  try {
    return await response.json()
  } catch {
    throw new ModelListRequestError('invalid_response', UNREADABLE_LIST_MESSAGE)
  }
}

/**
 * 拉取补充源并按 id 建索引。
 *
 * 整数页码翻页：从 1 开始，空页视为末尾，`maxPages` 兜底；任一页失败即整体失败
 * （补半份数据会让"有价格/没价格"在同一批模型里随机分布）。
 */
async function fetchEnrichmentById(
  provider: ModelProvider,
  enrichment: ModelListEnrichment,
  headers: Record<string, string>,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<ReadonlyMap<string, unknown>> {
  const byId = new Map<string, unknown>()
  for (let page = 1; page <= enrichment.pages.maxPages; page += 1) {
    const url = buildEnrichmentPageUrl(provider.baseUrl, enrichment, page)
    // baseUrl 在进入这里之前已校验过是 http(s) URL；这里只是防御不可解析的残值。
    if (url === undefined) throw new ModelListRequestError('invalid_base_url', INVALID_BASE_URL_MESSAGE)

    const payload = await requestJson(url, headers, apiKey, fetchImpl).catch((error: unknown) => {
      // 主列表已经成功、只有补充源失败时，把原因标出来：否则用户只会看到一句 HTTP 4xx。
      if (error instanceof ModelListRequestError) {
        throw new ModelListRequestError(
          error.reasonCode,
          `${ENRICHMENT_FAILURE_PREFIX}${error.message}`,
          error.upstreamMessage
        )
      }
      throw error
    })
    const list = readPath(payload, enrichment.itemsPath)
    if (!Array.isArray(list)) {
      throw new ModelListRequestError('invalid_response', `${ENRICHMENT_FAILURE_PREFIX}${UNREADABLE_LIST_MESSAGE}`)
    }

    for (const entry of list) {
      const rawId = readPath(entry, enrichment.idPath)
      if (typeof rawId !== 'string') continue
      const id = rawId.trim()
      if (id && !byId.has(id)) byId.set(id, entry)
    }
    if (list.length === 0) break
  }
  return byId
}

/**
 * 拉取并归一某家厂商的模型列表。
 *
 * 翻页：只在 `nextTokenPath` 取到非空 token 时继续，`maxPages` 兜底；任一页失败即整体失败
 * （返回半份列表会被 `buildModelSyncPreview` 误判成 missing）。
 *
 * 补充源：`shape.enrichment` 存在时，主列表之后再拉一次（可能多页）补充元数据。
 * 补充源**只按 id 补字段，不新增模型**，所以主列表仍是唯一的模型来源。
 */
export async function listRemoteModels(
  provider: ModelProvider,
  shape: ModelListShape,
  options: ListRemoteModelsOptions
): Promise<ModelDefinition[]> {
  const apiKey = provider.apiKey?.trim() ?? ''
  const host = shape.envelope === 'models' ? resolveGeminiHost(provider) : provider.baseUrl.trim()

  if (!host) throw new ModelListRequestError('invalid_base_url', MISSING_BASE_URL_MESSAGE)
  if (!isHttpUrl(host)) throw new ModelListRequestError('invalid_base_url', INVALID_BASE_URL_MESSAGE)
  if (!apiKey) throw new ModelListRequestError('missing_api_key', MISSING_API_KEY_MESSAGE)

  const baseUrl = buildModelListUrl(provider, shape)
  const headers = buildRequestHeaders(provider, shape, apiKey)
  const items: unknown[] = []
  let url = baseUrl
  let page = 0

  for (;;) {
    page += 1
    const payload = await requestJson(url, headers, apiKey, options.fetch)
    const pageItems = extractItems(payload, shape)
    if (pageItems === null) throw new ModelListRequestError('invalid_response', UNREADABLE_LIST_MESSAGE)
    items.push(...pageItems)

    const token = nextPageToken(payload, shape)
    if (shape.pagination === null || token === undefined || page >= shape.pagination.maxPages) break
    const separator = baseUrl.includes('?') ? '&' : '?'
    url = `${baseUrl}${separator}${shape.pagination.tokenParam}=${encodeURIComponent(token)}`
  }

  const enrichmentById = shape.enrichment
    ? await fetchEnrichmentById(provider, shape.enrichment, headers, apiKey, options.fetch)
    : undefined

  // T4/T5：同步时把供应商**当前**默认端点快照进模型协议（模型自带协议，之后不再跟随）。
  // 网关型供应商（`protocol-agnostic`）：三种格式由网关互转，实测任一模型三路都通 ⇒
  // 同步时直接把三条协议并进声明，用户拿到模型即带齐标签，无需「检测模型」。
  const allProtocols: readonly ModelChatProtocol[] | undefined =
    providerProtocolDeclarationOf(provider.id) === 'protocol-agnostic'
      ? ['chat-completions', 'responses', 'messages']
      : undefined
  return normalizeRemoteModels(items, shape, {
    providerDefaultProtocol: provider.endpoints[0]?.protocol,
    ...(allProtocols === undefined ? {} : { allProtocols }),
    ...(enrichmentById === undefined ? {} : { enrichmentById })
  })
}
