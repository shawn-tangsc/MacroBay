import { htmlPagePollerAdapter } from './htmlPagePoller'
import { metricRestApiAdapter } from './metricRestApiAdapter'
import { restApiPollerAdapter } from './restApiPoller'
import { rssPollerAdapter } from './rssPoller'
import { statuspagePollerAdapter } from './statuspagePoller'
import type { IntelligenceSourceAdapter } from './sourceAdapter'

export function listIntelligenceAdapters(): IntelligenceSourceAdapter[] {
  return [htmlPagePollerAdapter, rssPollerAdapter, statuspagePollerAdapter, restApiPollerAdapter, metricRestApiAdapter]
}

export function getIntelligenceAdapter(sourceId: string): IntelligenceSourceAdapter | undefined {
  return listIntelligenceAdapters().find((adapter) => adapter.supportedSourceIds.includes(sourceId))
}
