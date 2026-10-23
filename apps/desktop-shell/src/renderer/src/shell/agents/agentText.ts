import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { agentTextEn } from './agentTextEn'
import { agentTextZh } from './agentTextZh'
import type { AgentText } from './agentTextTypes'

export type { AgentText } from './agentTextTypes'

export const agentText: Record<AppLanguage, AgentText> = {
  'zh-CN': agentTextZh,
  'en-US': agentTextEn
}
