import { channelAdapterDescriptor } from './channelAdapterDescriptors'
import type { ChannelAdapterKey } from './ChannelManagementPredicates'

/**
 * 频道会话的名字：`Telegram 对话` / `Telegram · 贾维斯` / `Telegram · 8768`。
 *
 * 三条规矩（用户 2026-11-04 提的）：
 * - **平台名只从目录表取**（`channelAdapterDescriptor().displayName`），拼接处不许写死字面量——
 *   以后接 QQ / 微信 / Slack 全靠这张表；
 * - 同一平台有多个对方会话时加一段区分：优先对方显示名，拿不到就用会话 id 后 4 位；
 *   **不把完整 id 当名字**（太长，也把隐私边界混进名字里）；
 * - 只在**创建会话时**用这个名字：读者改过的名字一律不覆盖（我们从不改名）。
 */
export type ChannelConversationNameInput = {
  adapter: ChannelAdapterKey
  language: 'zh-CN' | 'en-US'
  /** 对方显示名（Telegram 的 first_name 这类）；拿不到就退回 id 后四位。 */
  displayLabel?: string
  /** 对方会话 id（平台原样，例如 chat id），用于后四位与「只有一个对话」时的判断。 */
  providerConversationKey: string
  /** 这条频道下已经有别的会话：需要加区分段。 */
  disambiguate: boolean
}

export function channelConversationTitle(input: ChannelConversationNameInput): string {
  const platform = channelAdapterDescriptor(input.adapter).displayName[input.language]
  const base = input.language === 'zh-CN' ? `${platform} 对话` : `${platform} conversation`
  if (!input.disambiguate) return base
  const suffix = discriminator(input)
  return suffix ? `${platform} · ${suffix}` : base
}

function discriminator(input: ChannelConversationNameInput): string | null {
  const label = input.displayLabel?.trim()
  if (label) return label.slice(0, 32)
  const id = input.providerConversationKey.trim()
  if (!id) return null
  // 会话键是 `<platform>:chat:<id>` 这类格式：先取最后一段，再取后四位。
  const tail = id.slice(id.lastIndexOf(':') + 1)
  return tail.length > 4 ? tail.slice(-4) : tail
}
