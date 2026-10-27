/**
 * 回放时的占位符替换与请求键归一化。
 *
 * 占位符只有四个，全部是「请求回显 / 墙钟」语义：它们**不会**生成观测时间——示例里的每个
 * `observedAt` 都是录制时库里真实的值，一个字符都不改。这一点是「不伪造实时性」的实现保证。
 */

export type SampleModePayloadContext = Readonly<{
  /** 请求里的 `asOf`：回显字段必须与请求一致，否则渲染层的契约校验会拒绝整份返回。 */
  asOf?: string
  scenarioNow: string
  wallNow: Date
}>

const AS_OF = '$asOf'
const SCENARIO_NOW = '$scenarioNow'
const WALL_NOW = '$wallNow'
const WALL_NOW_MS = '$wallNowMs'
const WALL_NOW_OFFSET = /^\$wallNowMs\+(\d{1,9})$/u

export function isSampleModePlaceholder(value: unknown): boolean {
  return typeof value === 'string' && (
    value === AS_OF || value === SCENARIO_NOW || value === WALL_NOW || value === WALL_NOW_MS ||
    WALL_NOW_OFFSET.test(value)
  )
}

function resolvePlaceholder(value: string, context: SampleModePayloadContext): unknown {
  if (value === SCENARIO_NOW) return context.scenarioNow
  if (value === WALL_NOW) return context.wallNow.toISOString()
  if (value === WALL_NOW_MS) return context.wallNow.getTime()
  const offset = WALL_NOW_OFFSET.exec(value)
  if (offset) return context.wallNow.getTime() + Number(offset[1])
  // `$asOf` 没有请求值时保留原样：宁可让契约校验失败，也不拿场景时钟去冒充请求上下文。
  return context.asOf === undefined ? value : context.asOf
}

/**
 * 深拷贝 + 占位符替换。每次调用都返回全新对象，调用方改坏返回值也污染不到下一份。
 */
export function materializeSampleModePayload(value: unknown, context: SampleModePayloadContext): unknown {
  if (typeof value === 'string') {
    return isSampleModePlaceholder(value) ? resolvePlaceholder(value, context) : value
  }
  if (Array.isArray(value)) return value.map((entry) => materializeSampleModePayload(entry, context))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = materializeSampleModePayload(entry, context)
    }
    return result
  }
  return value
}

export function readRequestAsOf(request: unknown): string | undefined {
  if (!request || typeof request !== 'object') return undefined
  const value = (request as Record<string, unknown>).asOf
  return typeof value === 'string' ? value : undefined
}

/** `month=2026-10` / `range=24h` / `id=sum_x` / `default`：只用于文件名，不参与业务判断。 */
export function requestKeyOf(request: unknown): string {
  if (!request || typeof request !== 'object') return 'default'
  const record = request as Record<string, unknown>
  for (const key of ['month', 'range', 'id', 'summaryId', 'cursor', 'itemId']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) {
      return `${key}=${value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 48)}`
    }
  }
  return 'default'
}
