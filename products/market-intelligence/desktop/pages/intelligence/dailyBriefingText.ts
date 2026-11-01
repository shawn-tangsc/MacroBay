import type { productText } from '../../shared/i18n/productText'

type DashboardText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']

export type DailyBriefingText = DashboardText['dailyBriefing']
