/**
 * Agent i18n React Context for injecting agentText by current app language.
 */
import { createContext, useContext } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { agentText, type AgentText } from './agentText'

const AgentTextContext = createContext<AgentText>(agentText['zh-CN'])
/** PLAT-70：智能体树里也需要平台级文案（例如厂商展示名），这里同时提供当前语言。 */
const AgentLanguageContext = createContext<AppLanguage>('zh-CN')

export function AgentTextProvider(props: {
  language: AppLanguage
  children: React.ReactNode
}): React.ReactElement {
  return (
    <AgentLanguageContext.Provider value={props.language}>
      <AgentTextContext.Provider value={agentText[props.language]}>{props.children}</AgentTextContext.Provider>
    </AgentLanguageContext.Provider>
  )
}

export function useAgentText(): AgentText {
  return useContext(AgentTextContext)
}

export function useAgentLanguage(): AppLanguage {
  return useContext(AgentLanguageContext)
}
