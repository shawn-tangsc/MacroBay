import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover as FocusPopover } from '@platform/ui/components/popover'

import type { CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'
import type { Text } from './crossAssetStatusRows'

/**
 * 实时报价那两条腿的状态句：**只说这条腿**，不说「这个资产没有数据」。
 *
 * 为什么单独搬出来：同一行 24h/7d 明明有数，一句笼统的「无数据」会被读成 bug（用户 2026-11-11），
 * 所以这里按腿分两句（`missing` 未连接 / `stale` 已过期），原因一律进 ⓘ，正文不铺解释句。
 * 搬出主文件顺带控体积（门禁 500 行），行为一字未改。
 */
export function CrossAssetQuoteLegStatus({ quotes, text, resolveProductText }: Readonly<{
  quotes: NonNullable<CrossAssetSnapshot['quotes']>
  text: Text
  resolveProductText: (key: string) => string
}>): React.ReactElement | null {
  const explained = (['btc', 'eth'] as const).filter(asset => quotes[asset].state !== 'live')
  if (explained.length === 0) return null

  return <div className="mi-cross-asset__status">{explained.map(asset => {
    const leg = quotes[asset].state === 'stale' ? 'stale' as const : 'missing' as const
    const reasonKey = leg === 'stale'
      ? 'pages.intelligence.portal.dashboard.crossAsset.quoteLegReasons.stale' as const
      : 'pages.intelligence.portal.dashboard.crossAsset.quoteLegReasons.missing' as const
    return <span key={asset} data-quote-asset={asset}>
      <small>{text.assets[asset]} {text.quoteLeg[leg]}</small>
      <FocusPopover labelKey={reasonKey} resolveText={resolveProductText}
        trigger={triggerProps => (
          <IconButton {...triggerProps} ariaLabelKey={reasonKey} icon={Info} size="sm" variant="plain"
            resolveText={resolveProductText} />
        )} />
    </span>
  })}</div>
}
