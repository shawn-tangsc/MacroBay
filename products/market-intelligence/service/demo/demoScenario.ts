/**
 * 示例模式的信封与策略（纯数据 + 纯函数，无 IO）。
 *
 * 这里的每一条规则都是「默认拒绝」的实现：示例数据只以 JSON 文件存在，一个文件只能声明自己是
 * 读接口（`effect: 'read'`）；写动词根本不看文件，直接拒绝。新增功能只需要放一个 JSON，
 * 不需要改这个文件里的任何代码。
 */

export type SampleModeLocale = 'zh-CN' | 'en-US'

export const SAMPLE_MODE_LOCALES = Object.freeze(['zh-CN', 'en-US'] as const)

export const SAMPLE_MODE_ERRORS = Object.freeze({
  /** 示例模式下触发了写接口：不落库、不联网，界面提示后恢复原状。 */
  readOnly: 'demo-mode-read-only',
  /** 这个接口在示例数据里没有覆盖：面板据此报缺，绝不返回空数据冒充。 */
  surfaceMissing: 'demo-surface-missing',
  /** 场景目录存在但没有任何可用场景。 */
  noScenario: 'demo-no-scenario',
  /** 暂停真实采集失败：不进入示例，避免半开状态。 */
  suspendFailed: 'demo-suspend-failed'
})

/** 示例模式自己的控制面方法：永远放行，由 `demoIpc` 处理。 */
export const SAMPLE_MODE_METHODS = Object.freeze({
  getState: 'intelligence.demo.getState',
  setActive: 'intelligence.demo.setActive'
})

/**
 * 写动词表。命中前缀即拒绝——这是「默认拒绝」的另一半：新加的写接口不必登记就会被挡住，
 * 只有显式列进 `SAMPLE_MODE_READ_VERBS` 的词才可能被误判，因此这里只放真正会改状态的动词。
 */
const SAMPLE_MODE_WRITE_VERBS = Object.freeze([
  'save', 'set', 'delete', 'clear', 'run', 'refresh', 'rebuild', 'rescore', 'reveal',
  'ingest', 'import', 'sync', 'retry', 'translate', 'request', 'start', 'cancel',
  'acquire', 'renew', 'release', 'test'
])

/** 读接口的动词白名单：只有这些词开头的接口才可能被示例数据服务。 */
const SAMPLE_MODE_READ_VERBS = Object.freeze([
  'get', 'list', 'query', 'read', 'explain', 'preview', 'calendarEventContext'
])

export function sampleModeLeaf(method: string): string {
  const index = method.lastIndexOf('.')
  return index === -1 ? method : method.slice(index + 1)
}

export function isSampleModeWriteMethod(method: string): boolean {
  if ((Object.values(SAMPLE_MODE_METHODS) as readonly string[]).includes(method)) return false
  const leaf = sampleModeLeaf(method)
  return SAMPLE_MODE_WRITE_VERBS.some((verb) => leaf.startsWith(verb))
}

export function isSampleModeReadMethod(method: string): boolean {
  if ((Object.values(SAMPLE_MODE_METHODS) as readonly string[]).includes(method)) return true
  const leaf = sampleModeLeaf(method)
  return !isSampleModeWriteMethod(method) && SAMPLE_MODE_READ_VERBS.some((verb) => leaf.startsWith(verb))
}

export function isSampleModeControlMethod(method: string): boolean {
  return (Object.values(SAMPLE_MODE_METHODS) as readonly string[]).includes(method)
}

/** `2026-10-24T20:00:00.000Z`：场景时钟、观测时间都用这一个形状。 */
export const SAMPLE_MODE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function isSampleModeInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !SAMPLE_MODE_INSTANT.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

export type SampleModeScenarioMeta = Readonly<{
  schemaVersion: 1
  id: string
  title: Readonly<Record<SampleModeLocale, string>>
  /** 数据窗口内最后一次观测的瞬时：示例模式下它就是「现在」。 */
  scenarioNow: string
  window: Readonly<{ from: string; to: string }>
  recordedAt: string
  sources: readonly string[]
  provenanceNote?: string
  licenseNote?: string
}>

/**
 * 一份 fixture。`payload` 是原样回放的返回体；`byRequest` 用于「同一个接口、不同请求参数」的场景
 * （日历按月、结论按 id），键取自请求里的 `byRequestKey` 字段。
 */
export type SampleModeFixture = Readonly<{
  schemaVersion: 1
  method: string
  effect: 'read'
  byRequestKey?: string
  payload?: unknown
  byRequest?: Readonly<Record<string, unknown>>
}>

export function sampleModeScenarioPath(filePath: string): { scenarioId: string; kind: 'meta' | 'surfaces'; locale?: undefined; name: string } | undefined {
  const match = /^.*\/scenarios\/([^/]+)\/(scenario|surfaces)\.json$/u.exec(filePath)
  if (!match) return undefined
  return { scenarioId: match[1]!, kind: match[2] === 'scenario' ? 'meta' : 'surfaces', name: match[2]! }
}

export function sampleModeResponsePath(filePath: string): { scenarioId: string; locale: 'common' | SampleModeLocale; name: string } | undefined {
  const match = /^.*\/scenarios\/([^/]+)\/responses\/(common|zh-CN|en-US)\/([^/]+)\.json$/u.exec(filePath)
  if (!match) return undefined
  return { scenarioId: match[1]!, locale: match[2] as 'common' | SampleModeLocale, name: match[3]! }
}

export type SampleModeProblems = readonly string[]

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : undefined
}

/** 场景元数据的解析：任何一项不合规就整份丢弃，绝不半信半疑地加载。 */
export function parseSampleModeScenarioMeta(value: unknown, expectedId: string): SampleModeScenarioMeta | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) return undefined
  if (record.id !== expectedId) return undefined
  const title = record.title as Record<string, unknown> | undefined
  const zh = readString(title?.['zh-CN'])
  const en = readString(title?.['en-US'])
  if (!zh || !en) return undefined
  const scenarioNow = record.scenarioNow
  const recordedAt = record.recordedAt
  if (!isSampleModeInstant(scenarioNow) || !isSampleModeInstant(recordedAt)) return undefined
  const window = record.window as Record<string, unknown> | undefined
  const from = window?.from
  const to = window?.to
  if (!isSampleModeInstant(from) || !isSampleModeInstant(to)) return undefined
  if (Date.parse(from) > Date.parse(to) || Date.parse(to) > Date.parse(scenarioNow)) return undefined
  const sources = readStringArray(record.sources)
  if (!sources) return undefined
  return Object.freeze({
    schemaVersion: 1,
    id: expectedId,
    title: Object.freeze({ 'zh-CN': zh, 'en-US': en }),
    scenarioNow,
    window: Object.freeze({ from, to }),
    recordedAt,
    sources: Object.freeze(sources),
    ...(readString(record.provenanceNote) ? { provenanceNote: readString(record.provenanceNote) } : {}),
    ...(readString(record.licenseNote) ? { licenseNote: readString(record.licenseNote) } : {})
  })
}

/** fixture 的解析：方法名必须与文件名一致，且只允许 `effect: 'read'`。 */
export function parseSampleModeFixture(value: unknown, expectedMethod: string): SampleModeFixture | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) return undefined
  if (record.method !== expectedMethod) return undefined
  if (record.effect !== 'read') return undefined
  const hasPayload = Object.hasOwn(record, 'payload')
  const byRequest = record.byRequest
  if (hasPayload === (byRequest !== undefined)) return undefined
  if (byRequest !== undefined) {
    if (!byRequest || typeof byRequest !== 'object' || Array.isArray(byRequest)) return undefined
    const key = readString(record.byRequestKey)
    if (!key) return undefined
    return Object.freeze({
      schemaVersion: 1 as const,
      method: expectedMethod,
      effect: 'read' as const,
      byRequestKey: key,
      byRequest: Object.freeze({ ...(byRequest as Record<string, unknown>) })
    })
  }
  return Object.freeze({ schemaVersion: 1 as const, method: expectedMethod, effect: 'read' as const, payload: record.payload })
}
