import { createContext, useContext } from 'react'

import type { AppLanguage } from '../../settings/schema/appSettings'

const ShellLanguageContext = createContext<AppLanguage>('zh-CN')

export function ShellLanguageProvider(props: {
  language: AppLanguage
  children: React.ReactNode
}): React.ReactElement {
  return <ShellLanguageContext.Provider value={props.language}>{props.children}</ShellLanguageContext.Provider>
}

export function useShellLanguage(): AppLanguage {
  return useContext(ShellLanguageContext)
}
