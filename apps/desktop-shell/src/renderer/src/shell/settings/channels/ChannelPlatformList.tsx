import { CHANNEL_DISPLAY_NAME, type ChannelTypeName } from '@platform/channels/channelDisplayNames'
import type { PlatformText } from '../../../i18n/platformText'
import { CHANNEL_PLATFORM_LOGOS } from './channelPlatformLogos'
import type { Catalog } from './channelSettingsPresentation'

/**
 * 中列最上方的平台切换列表（原型 A）。
 *
 * 从 `ChannelSettingsPage` 抽出来的：那一屏已经顶到 500 行硬线，而这一段是一个完整概念——
 * 「能在哪几个平台上开频道」。抽离只搬家，DOM 结构、类名、`data-implemented` 与读屏语义逐字保留。
 */
export type ChannelPlatformType = ChannelTypeName

/**
 * 只列**现在真的能开**的平台（产品 2026-11-09 定）：可选列表回答的是「我现在能用哪个」，
 * 不是「以后会支持什么」。未实现的四个（飞书 / QQ / 微信 / Discord）已从列表撤下——
 * 留着按不动的项只会教读者「这个列表不可信」。**不新增「敬请期待」入口**，支持现状只写在
 * 「已知限制」与版本说明里。
 *
 * 顺序照设计固定：Telegram → Slack（不按接入状态重排）。
 */
const PLATFORM_ORDER: readonly ChannelPlatformType[] = ['telegram', 'slack']

export function ChannelPlatformList(props: {
  labels: PlatformText['settings']
  selectedType: ChannelPlatformType
  onSelect: (type: ChannelPlatformType) => void
  catalog: readonly Catalog[]
  language: 'zh-CN' | 'en-US'
}): React.ReactElement {
  return (
    <nav aria-label={props.labels.channels} className="channel-platform-list">
      {/* 原型里中列最上方有一行「频道」，与左导航的分组标题同一级：小号、次要色。 */}
      <p className="channel-platform-heading">{props.labels.channels}</p>
      {PLATFORM_ORDER.map((type) => (
        /**
         * **例外（登记在案）**：这里保留原生 `<button>`，不换 antd 也不换 `IconButton`。
         * 原因是它**两行内容**（平台 logo 图形 + 平台名）且是列表项的整行点击区：
         * 换组件会改掉行高与排印。可访问性已具备——`aria-current` 标当前项，名字取自行内文字，
         * logo `aria-hidden`。改这一处要同时改中列的行模型，不属于「只换交互元素」。
         */
        <button
          aria-current={type === props.selectedType}
          className="channel-platform-item"
          data-implemented={props.catalog.find((entry) => entry.type === type)?.implemented === true}
          key={type}
          onClick={() => props.onSelect(type)}
          type="button"
        >
          <span aria-hidden="true" className="channel-platform-logo" data-platform-logo={type}>
            {CHANNEL_PLATFORM_LOGOS[type]()}
          </span>
          <span>{CHANNEL_DISPLAY_NAME[type][props.language]}</span>
        </button>
      ))}
    </nav>
  )
}
