import { productText } from '../../shared/i18n/productText'
import type { DashboardEconomicCalendarState } from './dashboardEconomicCalendarModel'
import type { DashboardFearGreedState } from './dashboardFearGreedModel'

/**
 * 看板自己那一份文案形状：宿主把产品文案装配成它，面板只认这里列出的键。
 */
export type CryptoDashboardText = {
  workspaceLabel: string
  title: string
  description: string
  configureSources: string
  /** TODO(0.4.3-settings-drawer): 静态配置抽屉的入口标签；数据接入后连同入口一起删。 */
  crossAsset: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['crossAsset']
  macroReleaseDynamics: {
    calendarAction: string
    sourceName: string
    sourceStates: Record<DashboardEconomicCalendarState['state'], string>
    manageSettings: string
  }
  fearGreed: { title: string; loading: string; empty: string; score: string; observedAt: string; sourceName: string; sourceStates: Record<DashboardFearGreedState['state'], string>; manageSettings: string; buckets: Record<'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed', string> }
  positioning: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['positioning']
  divergence: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['divergence']
  capitalConditions: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['capitalConditions']
  policyPath: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['policyPath']
  defensivePremium: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['defensivePremium']
  cellState: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['cellState']
  dailyBriefing: typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']['dailyBriefing']
}

