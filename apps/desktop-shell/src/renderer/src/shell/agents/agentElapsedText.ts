import type { AppLanguage } from '@platform/settings/schema/appSettings'

/** Wall-clock duration copy shared by the runtime summary and the task status panel. */
export function formatAgentElapsed(ms: number, language: AppLanguage): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return language === 'zh-CN' ? `${totalSeconds} 秒` : `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return language === 'zh-CN' ? `${minutes} 分 ${seconds} 秒` : `${minutes}m ${seconds}s`
}
