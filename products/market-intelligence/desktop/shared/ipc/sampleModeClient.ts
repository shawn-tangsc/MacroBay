/**
 * 示例模式的控制面客户端。
 *
 * 只有两个方法：读状态、开关。任何异常都收敛成「未开启」——横幅没出来是小事，
 * 把面板卡在加载态是大事。
 */

export type SampleModeState = Readonly<{
  active: boolean
  scenarioId?: string
  scenarioNow?: string
  locale?: 'zh-CN' | 'en-US'
  scenarioCount: number
  unavailableReason?: 'no-scenario' | 'suspend-failed'
}>

export const emptySampleModeState: SampleModeState = Object.freeze({ active: false, scenarioCount: 0 })

const PRODUCT_ID = 'market-intelligence'
const METHODS = { getState: 'intelligence.demo.getState', setActive: 'intelligence.demo.setActive' } as const

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function parseSampleModeState(value: unknown): SampleModeState {
  if (!value || typeof value !== 'object') return emptySampleModeState
  const record = value as Record<string, unknown>
  if (typeof record.active !== 'boolean') return emptySampleModeState
  const scenarioCount = typeof record.scenarioCount === 'number' && Number.isSafeInteger(record.scenarioCount)
    ? record.scenarioCount
    : 0
  const scenarioNow = typeof record.scenarioNow === 'string' && INSTANT.test(record.scenarioNow)
    ? record.scenarioNow
    : undefined
  const reason = record.unavailableReason === 'no-scenario' || record.unavailableReason === 'suspend-failed'
    ? record.unavailableReason
    : undefined
  return Object.freeze({
    active: record.active,
    scenarioCount,
    ...(typeof record.scenarioId === 'string' ? { scenarioId: record.scenarioId } : {}),
    ...(scenarioNow ? { scenarioNow } : {}),
    ...(record.locale === 'zh-CN' || record.locale === 'en-US' ? { locale: record.locale } : {}),
    ...(reason ? { unavailableReason: reason } : {})
  })
}

export type SampleModeClient = Readonly<{
  getState: () => Promise<SampleModeState>
  setActive: (active: boolean, scenarioId?: string) => Promise<SampleModeState>
}>

export function createSampleModeClient(
  invoke: (productId: string, method: string, payload: unknown) => Promise<unknown> =
    (productId, method, payload) => window.platform.products.invoke(productId, method, payload)
): SampleModeClient {
  return Object.freeze({
    async getState() {
      try {
        return parseSampleModeState(await invoke(PRODUCT_ID, METHODS.getState, {}))
      } catch {
        return emptySampleModeState
      }
    },
    async setActive(active: boolean, scenarioId?: string) {
      try {
        return parseSampleModeState(await invoke(PRODUCT_ID, METHODS.setActive, {
          active,
          ...(scenarioId ? { scenarioId } : {})
        }))
      } catch {
        return emptySampleModeState
      }
    }
  })
}

export const sampleModeClient = createSampleModeClient()
