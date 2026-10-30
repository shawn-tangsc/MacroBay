import type { JobRuntime } from '@platform/jobs'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import type { CapabilityDomain } from './capabilityTypes'
import type { CrossAssetOps, MacroCalendarOps } from './operationFacades'

export type ReadHandlerDeps = {
  jobRuntime: JobRuntime
  getAppLanguage: () => Promise<AppLanguage>
  macroCalendarOps: MacroCalendarOps
  crossAssetOps: CrossAssetOps
  /** The panel's own read, so a tool answer and the card can never disagree. */
  policyPath?: { read: (input: { asOf: string }) => unknown | undefined }
}

export const DOMAIN_ORDER: readonly CapabilityDomain[] = [
  'query',
  'source-config',
  'calendar',
  'translation',
  'cross-asset',
  'operations'
]

export type ListSourcesInput = { domain?: 'all' | 'dashboard' | 'calendar'; includeDisabled?: boolean }
export type SourceDetailInput = { sourceId: string }
export type TimelineInput = {
  view?: 'timeline' | 'workspace'
  limit?: number
  filters?: Record<string, unknown>
}
export type MacroCalendarInput = { month: string; asOf: string; from?: string; to?: string; maxEvents?: number }
export type NewsSentimentInput = {
  asOf: string
  window: '1h' | '4h' | '24h' | '7d' | 'all'
  scope?: 'market' | 'BTC' | 'ETH'
  direction?: 'all' | 'bullish' | 'bearish' | 'neutral' | 'mixed'
  sourceId?: string
  limit?: number
}
export type NewsSentimentItemInput = { itemId: string; asOf: string }
export type CrossAssetInput = { range: '1h' | '24h' | '7d'; asOf?: string }
export type DescribeCapabilitiesInput = {
  domain?: 'all' | CapabilityDomain
}
