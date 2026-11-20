import type { TransportErrorKind } from './structuredModelInvocationTypes'

/**
 * 把「没收到任何 HTTP 响应」的底层错误归进一个闭集。
 *
 * 调用方区分不了的事，这里不许猜：只有错误本身（错误码 / 消息）明确指向 DNS、拒绝、重置、
 * TLS、超时、中止时才给出对应类；其余一律 `unknown`。判据只读错误事实，不读耗时——按耗时
 * 猜成因正是 `connect-failed` 过去误报的来源（`analysisFailureDetail` 的 `connectFailureMaxMs`
 * 已退役）。
 *
 * 两套错误来源都要认：Node/undici 把原因放在 `cause.code`（`ENOTFOUND` 等），Electron 的
 * `net.fetch` 把 `net::ERR_*` 直接写进 `message`。
 */
export function classifyTransportError(error: unknown): TransportErrorKind {
  const haystack = collectErrorText(error)
  if (!haystack) return 'unknown'
  if (TIMEOUT_PATTERN.test(haystack)) return 'timeout'
  if (ABORTED_PATTERN.test(haystack)) return 'aborted'
  if (DNS_PATTERN.test(haystack)) return 'dns'
  if (REFUSED_PATTERN.test(haystack)) return 'refused'
  if (RESET_PATTERN.test(haystack)) return 'reset'
  if (TLS_PATTERN.test(haystack)) return 'tls'
  return 'unknown'
}

/** 顺序即优先级：超时最先，因为它常与连接类错误码同时出现（`UND_ERR_CONNECT_TIMEOUT`）。 */
const TIMEOUT_PATTERN = /TIMEOUT|TIMED_?OUT|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT/i
const ABORTED_PATTERN = /ABORTERROR|ERR_ABORTED|REQUEST_ABORTED|OPERATION_ABORTED/i
const DNS_PATTERN = /ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION|GETADDRINFO/i
const REFUSED_PATTERN = /ECONNREFUSED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_CLOSED/i
const RESET_PATTERN = /ECONNRESET|EPIPE|ERR_CONNECTION_RESET|ERR_SOCKET_CLOSED|UND_ERR_SOCKET|ERR_CONNECTION_ABORTED/i
const TLS_PATTERN = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_SSL|ERR_TLS|SSL_ERROR|EPROTO|TLS_/i

function collectErrorText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  // 只沿 `cause` 链走，最多四层：错误一旦成环或包装过深，继续读下去没有新事实。
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const record = current as { name?: unknown; message?: unknown; code?: unknown; errno?: unknown; cause?: unknown }
    if (typeof record.name === 'string') parts.push(record.name)
    if (typeof record.message === 'string') parts.push(record.message)
    if (typeof record.code === 'string') parts.push(record.code)
    if (typeof record.code === 'number') parts.push(String(record.code))
    if (typeof record.errno === 'string') parts.push(record.errno)
    if (typeof record.errno === 'number') parts.push(String(record.errno))
    current = record.cause
  }
  return parts.join(' ')
}
