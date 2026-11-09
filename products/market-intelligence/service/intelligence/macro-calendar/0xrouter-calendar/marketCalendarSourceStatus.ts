import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { zeroXRouterCalendarPublishesLocale } from '../../application/zeroXRouterSourcePolicy'

/**
 * 一条来源在**读者这次查询的语言**下该怎么标。
 *
 * 空批次有两种完全不同的意思，必须分开：
 * - `success-empty`：这条来源发布该语言，只是这个月确实没有事件；
 * - `no-locale-rows`：这条来源**根本不发布该语言**（今天：`financial-events` 与
 *   `central-bank-activities` 的 en 请求永远返回空数组），读者该做的是换来源或换语言，
 *   不是等下一次刷新。
 *
 * 只改呈现，不改存储：批次行仍按"这次拿到了几行"记 `success-empty`，那是事实；
 * 读者看到的判定由这一处给。
 */
export function marketCalendarSourceStatus(
  status: string,
  descriptorId: string,
  locale: string
): MarketCalendarSource['status'] {
  if (status === 'success-empty' && !zeroXRouterCalendarPublishesLocale(descriptorId, locale)) return 'no-locale-rows'
  return status as MarketCalendarSource['status']
}
