import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { dashboardFeedHealthPolicy, dashboardFeedRowHealth, projectDashboardFeedHealth, type DashboardFeedHealthPolicy } from './dashboardFeedStatusHealth'
import { dashboardFeedRowText, type DashboardFeedRow, type DashboardFeedRowState } from './dashboardFeedStatusModel'

const asOfMs = Date.parse('2026-09-14T12:00:00.000Z')
const zh = productText['zh-CN'].pages.intelligence.portal.dashboard
const en = productText['en-US'].pages.intelligence.portal.dashboard

/** A row as the projection hands it over. Only the fields the health split reads are filled in. */
const row = (id: DashboardFeedRow['id'], state: DashboardFeedRowState, over: Partial<DashboardFeedRow> = {}): DashboardFeedRow =>
  Object.freeze({ id, state, sourceId: 'realmarketapi-market', manageSourceId: 'realmarketapi-market', ...over })

const healthOf = (rows: readonly DashboardFeedRow[], text = zh.feedStatus, policy: DashboardFeedHealthPolicy = dashboardFeedHealthPolicy) =>
  projectDashboardFeedHealth(rows, text, policy)

/** The row as the reader sees it, so an assertion can quote the line the strip prints. */
const textOf = (entry: DashboardFeedRow, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string => {
  const dashboard = productText[locale].pages.intelligence.portal.dashboard
  return dashboardFeedRowText(entry, dashboard.feedStatus, {
    synthetic: dashboard.crossAsset.syntheticTag, proxy: dashboard.crossAsset.proxyTag, realIndex: dashboard.crossAsset.indexNames.real
  }, asOfMs).status
}

/** A state no release ships yet: it exists only to prove the safe default. */
const unknownState = 'collector-paused' as DashboardFeedRowState
const injectedPolicies: DashboardFeedRowState[] = []

function injectState(state: DashboardFeedRowState, healthy: boolean): void {
  const policy = dashboardFeedHealthPolicy as { healthy: Record<string, boolean> }
  policy.healthy[state] = healthy
  injectedPolicies.push(state)
}

afterEach(() => {
  const policy = dashboardFeedHealthPolicy as { healthy: Record<string, boolean> }
  for (const state of injectedPolicies.splice(0)) delete policy.healthy[state]
})

describe('dashboard feed health split', () => {
  it('is exhaustive over today\'s states and calls only 采集正常 healthy', () => {
    // The map is the policy: every state has a deliberate side, and a state that answers from a
    // stand-in is not healthy even when its own word says so.
    for (const state of Object.keys(zh.feedStatus.states) as DashboardFeedRowState[]) {
      expect(dashboardFeedHealthPolicy.healthy[state], state).toBeTypeOf('boolean')
      expect(dashboardFeedRowHealth(row('dollar', state)), state).toBe(state === 'ok' ? 'healthy' : 'needs-attention')
    }
    expect(dashboardFeedRowHealth(row('dollar', 'ok', { fallback: 'synthetic' }))).toBe('needs-attention')
    expect(dashboardFeedRowHealth(row('gold', 'ok', { fallback: 'proxy' }))).toBe('needs-attention')
  })

  it('summarises every healthy feed with its real count and names, and keeps no line for them', () => {
    const health = healthOf([
      row('dollar', 'ok'), row('gold', 'ok'), row('rates', 'ok'), row('index', 'ok')
    ])
    expect(health.hasSummary).toBe(true)
    expect(health.healthyCount).toBe(4)
    expect(health.healthyNames).toBe([
      zh.feedStatus.rowNames.dollar, zh.feedStatus.rowNames.gold, zh.feedStatus.rowNames.rates, zh.feedStatus.rowNames.index
    ].join(' · '))
    expect(health.attentionRows).toHaveLength(0)
  })

  it('prints no summary at all when nothing is healthy', () => {
    const health = healthOf([
      row('dollar', 'unconfigured', { fallback: 'synthetic' }),
      row('gold', 'configured-disabled'),
      row('rates', 'failed', { failureCode: 'credential-rejected' }),
      row('index', 'proxy', { fallback: 'proxy' })
    ])
    expect(health.hasSummary).toBe(false)
    expect(health.healthyCount).toBe(0)
    expect(health.healthyNames).toBe('')
    expect(health.attentionRows).toHaveLength(4)
  })

  it('keeps a 数据过期已回退 feed on its own line, worded with the panel\'s own 合成 tag', () => {
    const stale = row('dollar', 'stale-fallback', { fallback: 'synthetic', staleMinutes: 30, sourceId: 'realmarketapi-market' })
    const health = healthOf([stale, row('gold', 'ok'), row('rates', 'ok'), row('index', 'ok')])
    expect(health.hasSummary).toBe(true)
    expect(health.healthyCount).toBe(3)
    expect(health.attentionRows.map(entry => entry.id)).toEqual(['dollar'])
    const status = textOf(health.attentionRows[0]!)
    expect(status).toContain(zh.feedStatus.states['stale-fallback'])
    expect(status).toContain('30 分钟')
    // The same word the 市场状态 row prints beside the level: 合成值, not a second vocabulary.
    expect(status).toContain(`${zh.crossAsset.syntheticTag}值`)
    expect(status).not.toContain(zh.feedStatus.states.ok)
    expect(textOf(health.attentionRows[0]!, 'en-US')).toContain(`${en.crossAsset.syntheticTag} value`)
  })

  it('prints a failure as its code alone, never as a key or a URL', () => {
    const failed = row('rates', 'failed', { failureCode: 'rate-limit-exceeded', sourceId: 'fred-rates-liquidity' })
    const status = textOf(failed)
    expect(status).toContain('rate-limit-exceeded')
    for (const fragment of ['http', 'apikey', 'api_key', 'Bearer', 'token=']) expect(status).not.toContain(fragment)
    expect(healthOf([failed]).attentionRows).toHaveLength(1)
  })

  it('sends a state the policy has never heard of to 需要留意, never to the healthy summary', () => {
    expect(unknownState in zh.feedStatus.states).toBe(false)
    const health = healthOf([row('gold', 'ok'), row('dollar', unknownState)])
    expect(health.healthyCount).toBe(1)
    expect(health.attentionRows.map(entry => entry.id)).toEqual(['dollar'])
    expect(dashboardFeedRowHealth(row('dollar', unknownState))).toBe('needs-attention')
  })

  it('defaults a newly injected healthy state to whichever side the policy states, and back to the safe side without it', () => {
    injectState(unknownState, true)
    expect(dashboardFeedRowHealth(row('dollar', unknownState))).toBe('healthy')
    injectState(unknownState, false)
    expect(dashboardFeedRowHealth(row('dollar', unknownState))).toBe('needs-attention')
    // Removing the entry is what happens when the state is added to the type without a classification:
    // the lookup misses and the policy's own default decides.
    const policy = dashboardFeedHealthPolicy as { healthy: Record<string, boolean> }
    delete policy.healthy[unknownState]
    injectedPolicies.splice(injectedPolicies.indexOf(unknownState), 1)
    expect(dashboardFeedHealthPolicy.unknownStateHealth).toBe('needs-attention')
    expect(dashboardFeedRowHealth(row('dollar', unknownState))).toBe('needs-attention')
  })

  it('names the healthy feeds in both locales', () => {
    const health = healthOf([row('dollar', 'ok'), row('gold', 'ok')], en.feedStatus)
    expect(health.healthyNames).toBe(`${en.feedStatus.rowNames.dollar} · ${en.feedStatus.rowNames.gold}`)
  })
})
