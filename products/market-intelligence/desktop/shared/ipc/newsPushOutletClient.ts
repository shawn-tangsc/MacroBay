const PRODUCT_ID = 'market-intelligence'

/**
 * 「舆情提醒」开关的读写（设置 → 情报 → 通知 第四条）。
 *
 * 两条只在这里成立、页面不许绕开：
 * - **值只从服务读**：页面拿它显示，不自己存一份；两个来源必然会在某次切换后分叉；
 * - **写不传时间**：`at` 由服务端取「现在」——页面传时间就是第二个时钟，差一秒都会写进水位，
 *   而水位决定「哪条算新」。缺省留给服务端，是这两个入口唯一的正确用法。
 */

export type NewsPushOutletState = Readonly<{ enabled: boolean; enabledAt?: string }>

type Invoke = (productId: string, method: string, payload?: unknown) => Promise<unknown>

function invoke(): Invoke | undefined {
  const products = (window as unknown as { platform?: { products?: { invoke?: Invoke } } }).platform?.products
  if (!products?.invoke) return undefined
  return products.invoke.bind(products)
}

export type NewsPushOutletClient = Readonly<{
  state: () => Promise<NewsPushOutletState>
  setEnabled: (enabled: boolean) => Promise<NewsPushOutletState>
}>

export function createNewsPushOutletClient(): NewsPushOutletClient {
  const call = async (method: string, payload?: unknown): Promise<NewsPushOutletState> => {
    const send = invoke()
    if (send === undefined) throw new Error('product IPC bridge is unavailable')
    const result = await send(PRODUCT_ID, method, payload)
    if (!result || typeof result !== 'object' || typeof (result as { enabled?: unknown }).enabled !== 'boolean') {
      throw new Error('news push outlet service returned an unexpected shape')
    }
    const state = result as { enabled: boolean; enabledAt?: unknown }
    return {
      enabled: state.enabled,
      ...(typeof state.enabledAt === 'string' ? { enabledAt: state.enabledAt } : {})
    }
  }
  return {
    state: () => call('intelligence.getNewsPushOutletState'),
    // **不传 `at`**：时间由服务端取，页面没有第二个时钟。
    setEnabled: (enabled) => call('intelligence.setNewsPushOutletEnabled', { enabled })
  }
}

export const newsPushOutletClient: NewsPushOutletClient = createNewsPushOutletClient()
