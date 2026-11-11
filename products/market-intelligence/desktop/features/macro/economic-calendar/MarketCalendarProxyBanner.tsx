import type { ReactElement } from 'react'

import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { NetworkProxyBanner } from '../../../shared/NetworkProxyBanner'
import { useProxyConfigured } from '../../../shared/useProxyConfigured'
import { shouldShowMarketCalendarProxyNotice } from './marketCalendarProxyNotice'

/**
 * 日历页顶上那条代理横幅，档位跟着**读者真实的代理配置**走。
 *
 * `MI-11-R196` 的同一类病：只凭「传输层没回答」就说「去配一个代理」，读者明明已经填好了
 * （`http://127.0.0.1:7888` 带绕过规则），横幅还在让他再配一遍——提示与实际配置无关。
 *
 * 三种情形，各一个说法：
 * - 没配代理 + 这次没连上 → 「这个来源要走本地代理才能连」+「去设置代理」（原来那一档）；
 * - 配好了 + 这次没连上 → 「代理没通：这次没连上」+「检查代理地址」（地址/端口填错、代理程序没跑）；
 * - 配好了 + 没有失败 → **不显示**：没有任何要读者做的事。
 *
 * 判据只有「哪些源最近一次都按网络层失败了」（`shouldShowMarketCalendarProxyNotice`）与
 * 「代理是否配好」（`useProxyConfigured`，与供应商面板同一个读口），这里不另造判据。
 */
export function MarketCalendarProxyBanner({ sources, onOpenProxySettings }: Readonly<{
  sources: readonly MarketCalendarSource[]
  onOpenProxySettings: () => void
}>): ReactElement | null {
  const configured = useProxyConfigured()
  if (!shouldShowMarketCalendarProxyNotice(sources)) return null
  return <NetworkProxyBanner
    configured={configured}
    onOpenProxySettings={onOpenProxySettings}
    tone={configured ? 'failed' : 'requires'} />
}
