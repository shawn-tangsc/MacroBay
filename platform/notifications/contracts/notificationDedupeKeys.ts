/**
 * 去重键构造函数注册表（契约 §7.1）。
 *
 * 共用键最怕两边写法漂移：一漂移就永远合不上，读者收到两条。所以共用键不是模板，
 * 是这里注册的构造函数——**键字符串只有这一处实现**，调用点不许自己拼。
 *
 * 两条硬规矩：
 *  - **构造不出键返回 `undefined`，不许回退成空键或截断**：截断会造出两个不同的发生同键，
 *    合并后就是「BTC 的标题 + ETH 的正文」。
 *  - **productId 由平台补，不由调用方给**：这里的键不带 productId；提交时平台从目录取声明者
 *    的 productId 拼到键上（契约 §16.2b），调用方改不了自己的归属。
 */

/** 模块信号的资产枚举：封闭集合，加腿必须改这里并报版本。 */
export type ModuleSignalAsset = 'BTC' | 'ETH' | 'market'

/** 模块枚举：封闭集合；产品自己的 id 由下面的归一表映射，映射只许一处、必须穷举。 */
export type ModuleId = 'OI' | 'ETF'

export type NotificationDedupeBuilderId = 'moduleSignal' | 'sourceIssue'

/** 产品内部 id → 模块枚举。**唯一一处映射**；散在调用点就是两套拼法，迟早漏改一条。 */
const MODULE_ID_BY_PRODUCT_ID: Readonly<Record<string, ModuleId>> = Object.freeze({
  'open-interest': 'OI',
  'etf-flows': 'ETF'
})

const MODULE_ID_ALIASES: Readonly<Record<string, ModuleId>> = Object.freeze({ oi: 'OI', etf: 'ETF' })

const ASSET_ALIASES: Readonly<Record<string, ModuleSignalAsset>> = Object.freeze({
  btc: 'BTC',
  eth: 'ETH',
  market: 'market'
})

/** 键长上限：超过就是输入有问题，不截断（截断必然撞键）。 */
const MAX_DEDUPE_KEY_LENGTH = 200
const MAX_RULE_ID_LENGTH = 64
const DAY_MS = 86_400_000

export type ModuleSignalDedupeInput =
  | {
      moduleId: string
      ruleId: string
      asset: string | null
      /** UTC、Z 结尾、整毫秒。桶由构造函数算，调用方不拼时间串。 */
      observedAt: string
      cadence: 'intraday'
      bucketMs: number
    }
  | {
      moduleId: string
      ruleId: string
      asset: string | null
      observedAt: string
      cadence: 'trading-day'
    }

export type SourceIssueDedupeInput = { sourceId: string }

export const notificationDedupeBuilders = Object.freeze({
  /**
   * 模块信号（含未来的 AI 解析）共用：键 = **一次发生**——哪个模块、哪条规则、哪个资产、哪一个桶。
   *
   * `cadence` 是判别式，不是一个数字：`intraday` 必须带 `bucketMs`，`trading-day` 不许带；
   * 日线规则写个桶宽就是「一天」被写成毫秒。类型上就构造不出来，不靠运行时自觉。
   *
   * **分析窗（24h / 7d）不进键**：键里带的是这次发生，不是分析范围；带窗会让每天都新开一条。
   */
  moduleSignal(input: ModuleSignalDedupeInput): string | undefined {
    const moduleId = normalizeModuleId(input.moduleId)
    if (moduleId === undefined) return undefined
    const ruleId = normalizeRuleId(input.ruleId)
    if (ruleId === undefined) return undefined
    const asset = normalizeAsset(input.asset)
    if (asset === undefined) return undefined
    const observedMs = parseUtcInstant(input.observedAt)
    if (observedMs === undefined) return undefined

    const bucket = bucketToken(observedMs, input.cadence === 'intraday' ? input.bucketMs : DAY_MS)
    if (bucket === undefined) return undefined

    return capped(`module-signal:${moduleId}:${ruleId}:${asset}:${bucket}`)
  },

  /** 来源「连续失败」与「长时间没数据」共用：键 = 这个来源的持续状况。 */
  sourceIssue(input: SourceIssueDedupeInput): string | undefined {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId.trim() : ''
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(sourceId)) return undefined
    return capped(`source-issue:${sourceId}`)
  }
})

/** 构造函数只需一个判别值；注册表是闭集，未知 id 一律拒绝（不猜）。 */
export function isNotificationDedupeBuilderId(value: unknown): value is NotificationDedupeBuilderId {
  return value === 'moduleSignal' || value === 'sourceIssue'
}

function normalizeModuleId(value: string): ModuleId | undefined {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const byProductId = MODULE_ID_BY_PRODUCT_ID[trimmed]
  if (byProductId !== undefined) return byProductId
  return MODULE_ID_ALIASES[trimmed]
}

/**
 * 规则名属于产品，平台不认识它：这里只能校验形状，不假装能枚举。
 * 形状：小写字母/数字开头，连字符分段，长度上限。
 */
function normalizeRuleId(value: string): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (trimmed.length === 0 || trimmed.length > MAX_RULE_ID_LENGTH) return undefined
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : undefined
}

function normalizeAsset(value: string | null): ModuleSignalAsset | undefined {
  if (value === null) return 'market'
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return ASSET_ALIASES[trimmed]
}

/** 只接受 UTC、Z 结尾、整毫秒的时刻（与契约 §3.2 的 `occurredAt` 同格式）。 */
function parseUtcInstant(value: string): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

/** 桶的起点（UTC ISO 串）。日线桶就是一个 UTC 自然日：`YYYY-MM-DD`。 */
function bucketToken(observedMs: number, bucketMs: number): string | undefined {
  if (bucketMs === DAY_MS) return new Date(observedMs).toISOString().slice(0, 10)
  if (!Number.isInteger(bucketMs) || bucketMs <= 0 || bucketMs > DAY_MS) return undefined
  return new Date(Math.floor(observedMs / bucketMs) * bucketMs).toISOString()
}

function capped(key: string): string | undefined {
  return key.length <= MAX_DEDUPE_KEY_LENGTH ? key : undefined
}
