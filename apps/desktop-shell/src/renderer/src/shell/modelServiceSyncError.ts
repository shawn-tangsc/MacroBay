import type { PlatformText } from '../i18n/platformText'

/**
 * PLAT-61：模型同步失败的**友好化**（A 层 renderer）。
 *
 * 任何 UI 都不允许出现 `Error invoking remote method …` / `platform:<channel>` / 原始堆栈。
 * 主进程现在返回结构化 `{ ok:false, reasonCode, message }`；这里只负责
 * 「reasonCode → 人话」与「万一仍抛原始 Error，也先把通道前缀洗掉」。
 */
export type ModelSyncErrorState = {
  reasonCode: string
  message: string
  /** 上游响应体里的错误 message（已脱敏）；主文案拼 `{原因}：{上游}`。 */
  upstreamMessage?: string
}

const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*':\s*/i
const ERROR_NAME_PREFIX = /^(?:Error|TypeError|RangeError|SyntaxError):\s*/i

export function sanitizeIpcErrorMessage(error: unknown): string | null {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''
  if (!raw.trim()) return null

  let text = raw.trim()
  for (let index = 0; index < 3; index += 1) {
    const next = text.replace(IPC_ERROR_PREFIX, '').replace(ERROR_NAME_PREFIX, '')
    if (next === text) break
    text = next
  }
  text = text
    // 通道名不进入 UI；URL 也不展示（可能带查询参数）。
    .replace(/platform:[a-z0-9-]+/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length === 0 ? null : text.slice(0, 200)
}

export function resolveModelSyncReasonText(reasonCode: string, labels: PlatformText['models']): string {
  switch (reasonCode) {
    case 'provider_disabled':
      return labels.connectionCheckReasonProviderDisabled
    case 'missing_api_key':
      return labels.connectionCheckReasonMissingApiKey
    case 'invalid_base_url':
      return labels.modelSyncReasonInvalidBaseUrl
    case 'provider_not_found':
      return labels.modelSyncReasonProviderNotFound
    case 'model_list_unsupported':
      return labels.modelSyncReasonModelListUnsupported
    case 'unauthorized':
    case 'http_401':
      return labels.connectionCheckReasonUnauthorized
    case 'http_403':
      return labels.connectionCheckReasonForbidden
    case 'http_404':
      return labels.connectionCheckReasonNotFound
    case 'http_5xx':
      return labels.connectionCheckReasonServerError
    case 'network':
      return labels.modelSyncReasonNetwork
    case 'network_dns':
    case 'dns_error':
      return labels.connectionCheckReasonDns
    case 'network_refused':
    case 'connection_refused':
      return labels.connectionCheckReasonRefused
    case 'network_timeout':
    case 'timeout':
      return labels.connectionCheckReasonTimeout
    case 'tls_error':
      return labels.connectionCheckReasonTls
    case 'proxy_error':
      return labels.connectionCheckReasonProxy
    case 'invalid_response':
      return labels.connectionCheckReasonInvalidResponse
    case 'account_balance_insufficient':
      return labels.connectionCheckReasonAccountBalance
    case 'rate_limited':
      return labels.connectionCheckReasonRateLimited
    case 'protocol_unsupported':
      return labels.connectionCheckReasonProtocolUnsupported
    case 'model_not_found':
      return labels.connectionCheckReasonModelNotFound
    default: {
      const status = Number(reasonCode.slice('http_'.length))
      if (reasonCode.startsWith('http_') && Number.isFinite(status)) {
        return labels.connectionCheckReasonHttp(status)
      }
      return labels.modelSyncReasonUnknown
    }
  }
}

/** 「未知错误」必须附原始信息（引导检查代理/重试）；通用兜底串不重复展示。 */
export function resolveModelSyncFailureDetail(error: ModelSyncErrorState | null, labels: PlatformText['models']): string | null {
  if (error === null) return null
  const detail = sanitizeIpcErrorMessage(error.message)
  if (detail === null) return null
  // 「未知错误」必须附原始信息；其它可归类原因不重复展示通用兜底串。
  if (error.reasonCode === 'unknown') return detail
  if (detail === 'Model sync failed.' || detail === labels.modelSyncFailed) return null
  return detail
}

export function formatModelSyncFailureText(
  reasonCode: string,
  labels: PlatformText['models'],
  upstreamMessage?: string
): string {
  const reason = resolveModelSyncReasonText(reasonCode, labels)
  // PLAT-66：「该供应商不支持模型列表」是能力说明而不是失败，别加「获取模型列表失败：」前缀。
  if (reasonCode === 'model_list_unsupported') return reason
  const composed = upstreamMessage && upstreamMessage.trim().length > 0
    ? `${reason}${/[\u4e00-\u9fff]/.test(reason) ? '：' : ': '}${upstreamMessage}`
    : reason
  return `${labels.fetchModelsFailed}${composed}`
}
