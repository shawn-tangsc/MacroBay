/**
 * 产品内的来源变更广播：来源启停/保存后，门户用它重读 `getAgentView`，
 * 让「无真实来源」空态 CTA 在不需要重开门户的情况下出现/消失。
 *
 * 只用于同一 renderer 内；不扩平台 IPC。
 */
export const INTELLIGENCE_SOURCES_CHANGED_EVENT = 'market-intelligence:sources-changed'

export function notifyIntelligenceSourcesChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(INTELLIGENCE_SOURCES_CHANGED_EVENT))
}
