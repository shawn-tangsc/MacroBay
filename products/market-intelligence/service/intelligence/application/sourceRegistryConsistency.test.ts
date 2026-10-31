import { describe, expect, it } from 'vitest'

import { calendarFeedRegistry } from '../macro-calendar/calendarFeedRegistry'
import { allSources } from './providerRegistry'
import { listIntelligenceSourceDefinitions } from './sourceCatalog'

/**
 * The three registries a source can live in:
 *
 * - `providerRegistry` is what the settings page and the dashboard read: grouping, visibility,
 *   capability switches.
 * - `sourceCatalog` is what an adapter reads: parser strategy, endpoint, readiness.
 * - `calendarFeedRegistry` is what the calendar views read: feed order, owner, schedule.
 *
 * Nothing makes the three agree at compile time, and a source added to one but not the others is
 * invisible instead of broken — the hardest kind of registry bug to notice. This audit is the only
 * thing that turns that difference into a red test, so it stays parameterised: it must be provable
 * that a broken registry fails, not just that today's registries pass.
 */

export type CatalogView = Readonly<{
  sourceId: string
  readiness?: string
  visibility?: string
  supportsRunNow: boolean
}>

export type ProviderSourceView = Readonly<{
  sourceId: string
  providerId: string
  readiness: string
  visibility: string
  capabilities: Readonly<{ runNow: string }>
  adapterRef?: string
}>

export type CalendarFeedView = Readonly<{ feedId: string; providerId: string }>

export type RegistryAuditFinding = Readonly<{ code: string; sourceId: string; detail: string }>

export type RegistryAuditInput = Readonly<{
  catalog: readonly CatalogView[]
  providers: readonly ProviderSourceView[]
  feeds: readonly CalendarFeedView[]
}>

export function auditSourceRegistries(input: RegistryAuditInput): readonly RegistryAuditFinding[] {
  const findings: RegistryAuditFinding[] = []
  const catalogById = new Map(input.catalog.map((source) => [source.sourceId, source]))
  const providerById = new Map(input.providers.map((source) => [source.sourceId, source]))
  const feedById = new Map(input.feeds.map((feed) => [feed.feedId, feed]))

  // A source an adapter can collect but the settings page never lists cannot be switched on.
  for (const source of input.catalog) {
    if (!providerById.has(source.sourceId)) {
      findings.push({ code: 'catalog-source-unregistered', sourceId: source.sourceId, detail: 'sourceCatalog has it, providerRegistry does not' })
    }
  }

  // The other direction is only a defect when the provider claims an adapter behind it.
  for (const source of input.providers) {
    if (source.adapterRef !== undefined && !catalogById.has(source.adapterRef)) {
      findings.push({ code: 'adapter-ref-missing', sourceId: source.sourceId, detail: `adapterRef ${source.adapterRef} is not in sourceCatalog` })
    }
    const isCalendarFeed = feedById.has(source.sourceId)
    if (!catalogById.has(source.sourceId) && !isCalendarFeed) {
      findings.push({ code: 'provider-source-uncollected', sourceId: source.sourceId, detail: 'providerRegistry has it, neither sourceCatalog nor calendarFeedRegistry does' })
    }
  }

  for (const feed of input.feeds) {
    const source = providerById.get(feed.feedId)
    if (!source) {
      findings.push({ code: 'calendar-feed-unregistered', sourceId: feed.feedId, detail: 'calendarFeedRegistry has it, providerRegistry does not' })
      continue
    }
    if (source.providerId !== feed.providerId) {
      findings.push({ code: 'calendar-provider-mismatch', sourceId: feed.feedId, detail: `${feed.providerId} vs ${source.providerId}` })
    }
  }

  for (const providerSource of input.providers) {
    const catalogSource = catalogById.get(providerSource.sourceId)
    if (!catalogSource) continue
    const catalogReadiness = catalogSource.readiness ?? 'live'
    if (catalogReadiness !== providerSource.readiness) {
      findings.push({ code: 'readiness-disagreement', sourceId: providerSource.sourceId, detail: `${catalogReadiness} vs ${providerSource.readiness}` })
    }
    // `hidden` is the one visibility both registries can state; pending/advanced are settings-page
    // refinements of a source the collector still sees.
    const catalogHidden = catalogSource.visibility === 'hidden'
    const providerHidden = providerSource.visibility === 'hidden'
    if (catalogHidden !== providerHidden) {
      findings.push({ code: 'visibility-disagreement', sourceId: providerSource.sourceId, detail: `catalog hidden=${catalogHidden}, provider hidden=${providerHidden}` })
    }
    const providerRunnable = providerSource.capabilities.runNow !== 'none'
    if (catalogSource.supportsRunNow !== providerRunnable) {
      findings.push({ code: 'run-now-disagreement', sourceId: providerSource.sourceId, detail: `catalog ${catalogSource.supportsRunNow}, provider runNow=${providerSource.capabilities.runNow}` })
    }
  }

  return findings
}

function liveRegistries(): RegistryAuditInput {
  return {
    catalog: listIntelligenceSourceDefinitions().map((source) => ({
      sourceId: source.sourceId,
      ...(source.readiness ? { readiness: source.readiness } : {}),
      visibility: source.visibility,
      supportsRunNow: source.supportsRunNow
    })),
    providers: allSources().map((source) => ({
      sourceId: source.sourceId,
      providerId: source.providerId,
      readiness: source.readiness,
      visibility: source.visibility,
      capabilities: { runNow: source.capabilities.runNow },
      ...(source.adapterRef ? { adapterRef: source.adapterRef } : {})
    })),
    feeds: Object.values(calendarFeedRegistry).map((feed) => ({ feedId: feed.feedId, providerId: feed.providerId }))
  }
}

describe('source registry consistency', () => {
  it('keeps the three registries agreeing on every source', () => {
    expect(auditSourceRegistries(liveRegistries())).toEqual([])
  })

  it('catches an adapterRef that points at no catalog entry', () => {
    const registries = liveRegistries()
    const broken: RegistryAuditInput = {
      ...registries,
      providers: registries.providers.map((source) => source.sourceId === 'realmarketapi-market' ? { ...source, adapterRef: 'ghost-adapter' } : source)
    }
    expect(auditSourceRegistries(broken)).toContainEqual(expect.objectContaining({ code: 'adapter-ref-missing', sourceId: 'realmarketapi-market' }))
  })

  it('catches a calendar feed that no provider lists', () => {
    const registries = liveRegistries()
    const broken: RegistryAuditInput = { ...registries, providers: registries.providers.filter((source) => source.sourceId !== 'macro-calendar-bls') }
    expect(auditSourceRegistries(broken)).toContainEqual(expect.objectContaining({ code: 'calendar-feed-unregistered', sourceId: 'macro-calendar-bls' }))
  })

  it('catches a capability stated only on one side', () => {
    const registries = liveRegistries()
    const broken: RegistryAuditInput = {
      ...registries,
      providers: registries.providers.map((source) => source.sourceId === 'fred-rates-liquidity' ? { ...source, capabilities: { runNow: 'none' } } : source)
    }
    expect(auditSourceRegistries(broken)).toContainEqual(expect.objectContaining({ code: 'run-now-disagreement', sourceId: 'fred-rates-liquidity' }))
  })
})
