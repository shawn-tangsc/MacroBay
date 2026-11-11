import { Button } from 'antd'
import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover as FocusPopover } from '@platform/ui/components/popover'

import { crossAssetTextKeys } from './crossAssetTextKeys'
import type { Text } from './crossAssetStatusRows'

/**
 * 市场状态块的标题行：标题、代理说明的 ⓘ，以及**这一张卡唯一的「补数据」按钮**。
 *
 * 搬出主文件只为控体积（门禁 500 行），行为一字未改；按钮什么时候出现、说什么、
 * 点了去哪，仍由调用方算好再传进来（`action`）——这里不认识数据、不判断状态。
 */
export function CrossAssetStatusHeading({ text, resolveProductText, action }: Readonly<{
  text: Text
  resolveProductText: (key: string) => string
  /** 有源没配好 →「启用数据」；配好了但读不到 →「再试一次」；都读到 → 不给。 */
  action?: Readonly<{ label: string; run: () => void }>
}>): React.ReactElement {
  return <div className="mi-cross-asset__quote-heading"><h3>{text.statusTitle}</h3>
    {/* 这段是代理说明，一段话而不是一句：走浮层（多行走浮层），点一下钉住。
        原来它挂在 `Tooltip` 上、`onSelect` 是空的——一段远长于提示上限的话配一颗点了没反应的 ⓘ，
        两处都不对（界面设计 2026-11-07：补充说明要么有真动作，要么不该长成按钮）。
        没改成 dialog：dialog 是给成组的多行读数用的（那张表 8 行分三组），一段话说清的事用浮层就够。 */}
    <FocusPopover labelKey={crossAssetTextKeys.subtitle} resolveText={resolveProductText}
      trigger={(triggerProps) => (
        <IconButton
          ariaLabelKey={crossAssetTextKeys.subtitle}
          expanded={triggerProps.expanded}
          icon={Info}
          onBlur={triggerProps.onBlur}
          onFocus={triggerProps.onFocus}
          onMouseEnter={triggerProps.onMouseEnter}
          onMouseLeave={triggerProps.onMouseLeave}
          onSelect={triggerProps.onSelect}
          resolveText={resolveProductText}
          size="md"
          variant="plain"
        />
      )} />
    {/* 标题右边、ⓘ 之后：同屏唯一的那颗「补数据」按钮。 */}
    {action === undefined ? null : <Button size="small" onClick={action.run}>{action.label}</Button>}
  </div>
}
