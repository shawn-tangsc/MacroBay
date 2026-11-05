import type { LocalizedText } from '../product-manifest'

/**
 * 通道显示名，**一处定义、两种语言各一条**。
 *
 * 键是**对外类型名**——也就是存库的基列 `type`（`agent_channels.type`），不是适配器层的
 * `adapter_key`。两者只在飞书这一处不同：`type = 'feishu'`，而适配器层用 `lark`
 * （DB 里的生成列 `case when type = 'feishu' then 'lark' else type end` 做桥接，
 * 见 `platform/ai/agent-platform/db/createAgentPlatformDatabase.ts`）。
 *
 * 为什么放在平台层：维护作业的标题要拼「{channel} 运行时维护」，而作业定义在平台侧，
 * 不能 import 渲染层；这张表原先只在 `platformText.ts` 里，作业拿不到。
 */
export type ChannelTypeName = 'telegram' | 'feishu' | 'qq' | 'wechat' | 'discord' | 'slack'

export const CHANNEL_DISPLAY_NAME: Record<ChannelTypeName, LocalizedText> = {
  telegram: { 'zh-CN': 'Telegram', 'en-US': 'Telegram' },
  feishu: { 'zh-CN': '飞书', 'en-US': 'Lark' },
  qq: { 'zh-CN': 'QQ', 'en-US': 'QQ' },
  wechat: { 'zh-CN': '微信', 'en-US': 'WeChat' },
  discord: { 'zh-CN': 'Discord', 'en-US': 'Discord' },
  slack: { 'zh-CN': 'Slack', 'en-US': 'Slack' }
}

/**
 * 适配器键 → 对外类型名。**唯一的反向桥**。
 *
 * 它与 DB 那条生成列是同一算法的两个方向，所以有一个守卫按建表文本核对
 * （`channelDisplayNames.test.ts`）：生成列改了而这里没跟，那条会红。
 */
export const CHANNEL_TYPE_BY_ADAPTER_KEY: Readonly<Record<string, ChannelTypeName>> = {
  telegram: 'telegram',
  slack: 'slack',
  lark: 'feishu',
  qq: 'qq',
  discord: 'discord',
  wechat: 'wechat'
}
