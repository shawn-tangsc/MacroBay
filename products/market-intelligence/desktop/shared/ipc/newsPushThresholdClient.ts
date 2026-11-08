import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'

const PRODUCT_ID = 'market-intelligence'

/**
 * 「舆情提醒 · 强度门槛」的读写（弱 / 中 / 强）。
 *
 * 与「舆情提醒」那个开关同一套规矩：**值只从服务读**，页面不自己存一份真值；写完读回的值说了算。
 * 合法档位只认三个，服务端已经把非法值挡在外面（写只接受三档之一），这一层再校验一次是为了
 * 让「服务返回了一个看不懂的东西」变成**错误**，而不是被页面猜成一个档。
 */
export type NewsPushThresholdState = Readonly<{ pushThreshold: NewsSentimentTierThreshold }>

type Invoke = (productId: string, method: string, payload?: unknown) => Promise<unknown>

function invoke(): Invoke | undefined {
  const products = (window as unknown as { platform?: { products?: { invoke?: Invoke } } }).platform?.products
  if (!products?.invoke) return undefined
  return products.invoke.bind(products)
}

const THRESHOLDS = ['low', 'medium', 'high'] as const

function readState(value: unknown): NewsPushThresholdState {
  const threshold = (value as { pushThreshold?: unknown } | null)?.pushThreshold
  if (typeof threshold !== 'string' || !(THRESHOLDS as readonly string[]).includes(threshold)) {
    throw new Error('news push threshold service returned an unexpected shape')
  }
  return { pushThreshold: threshold as NewsSentimentTierThreshold }
}

export type NewsPushThresholdClient = Readonly<{
  state: () => Promise<NewsPushThresholdState>
  save: (pushThreshold: NewsSentimentTierThreshold) => Promise<NewsPushThresholdState>
}>

export function createNewsPushThresholdClient(): NewsPushThresholdClient {
  const send = async (method: string, payload?: unknown): Promise<NewsPushThresholdState> => {
    const call = invoke()
    if (call === undefined) throw new Error('product IPC bridge is unavailable')
    return readState(await call(PRODUCT_ID, method, payload))
  }
  return {
    state: () => send('intelligence.getNewsPushThreshold'),
    save: (pushThreshold) => send('intelligence.saveNewsPushThreshold', { pushThreshold })
  }
}

export const newsPushThresholdClient: NewsPushThresholdClient = createNewsPushThresholdClient()
