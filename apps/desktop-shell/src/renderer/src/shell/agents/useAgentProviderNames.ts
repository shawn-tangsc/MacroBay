import { platformText } from '../../i18n/platformText'

import { useAgentLanguage } from './agentTextProvider'

/**
 * PLAT-70：厂商展示名（与模型服务页同一套 `providerNames` 文案）。
 * 智能体树没有平台设置上下文，这里按当前界面语言取一次。
 */
export function useAgentProviderNames(): Record<string, string> {
  return platformText[useAgentLanguage()].models.providerNames
}
