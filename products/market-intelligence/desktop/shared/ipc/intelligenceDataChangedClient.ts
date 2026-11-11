import {
  INTELLIGENCE_DATA_CHANGED_EVENT,
  parseIntelligenceDataChanged,
  type IntelligenceDataChangedPayload
} from '../../../contracts/intelligenceDataChangedEvent'

const PRODUCT_ID = 'market-intelligence'

/** 产品事件通道的订阅形状（preload 暴露的那一个）；用例可注入自己的。 */
export type ProductEventSubscribe = (
  productId: string,
  event: string,
  listener: (data: unknown) => void
) => () => void

/**
 * 真实读口。宿主没有这条通道时**什么也不订**（不报错、不重试）：这是刷新信号，不是数据读口，
 * 订不上最多是「要等兜底轮询」，不该让页面挂掉。
 */
function subscribeProductEvent(
  productId: string,
  event: string,
  listener: (data: unknown) => void
): () => void {
  const products = typeof window === 'undefined' ? undefined : window.platform?.products
  if (typeof products?.onEvent !== 'function') return () => {}
  return products.onEvent(productId, event, listener)
}

/**
 * 「采集写了库」的订阅口：形状解析在契约里，读方只拿一份可信载荷。
 *
 * **订阅在发起读、持有那份读数的那个 hook 里**，不在卡片里：订阅数等于「谁发起了读」的个数，
 * 不是「谁显示了数据」的个数。重复投递由读方同一次渲染合并（见各读口的 `revision`）。
 */
export function subscribeIntelligenceDataChanged(
  listener: (payload: IntelligenceDataChangedPayload) => void,
  subscribe: ProductEventSubscribe = subscribeProductEvent
): () => void {
  return subscribe(PRODUCT_ID, INTELLIGENCE_DATA_CHANGED_EVENT, (raw) => {
    const payload = parseIntelligenceDataChanged(raw)
    if (payload !== undefined) listener(payload)
  })
}
