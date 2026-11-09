import type { ReactElement } from 'react'

import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'

import { openIntelligenceSourcesSettings } from '../../../shared/navigation/productShellNavigation'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * 一条官方日历来源都没启用时的整页状态。
 *
 * 与「本月确实没有」是两件事（产品 2026-11-09）：「没有」是采集正常、确实空；「拿不到」是通路没开。
 * 所以这里用 `disabled`（读者自己关的），不是 `empty`，也不是「取不到」那一支（BLS 403 走另一条分支）。
 *
 * 动作只有一个：**去启用**。它读的是共享动作键 `enable`——平台把 `target-disabled` 的动作白名单锁在
 * 「启用」上，为这一个页面把 `open-settings` 加进去不值；读者要做的动作也确实就是去把来源启用。
 * 点击落到情报源设置面板：那里才是真正能动的地方。
 */
export function CalendarNoSourceEnabledState({ text }: { text: EconomicCalendarText }): ReactElement {
  return <StateView
    action={{ labelKey: STATE_VIEW_ACTION_KEYS.enable, onSelect: openIntelligenceSourcesSettings }}
    className="mi-economic-calendar__no-source-state"
    productReason={{ key: 'mi.calendar.no-source-enabled', resolve: () => text.status.noSourceEnabled }}
    reasonCode="target-disabled"
    size="lg"
    state="disabled"
  />
}
