import type { PanelView, ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * The main process owns the enabled/health state, but a running build can lag behind a newly
 * assigned panel. Merge only the sources the renderer's registry knows and the IPC view does not,
 * keeping every remote field authoritative; a lagging build cannot make a source disappear from
 * the drawer that must configure it.
 */
export function mergeDashboardPanelView(remote: PanelView | undefined, local: PanelView | undefined): PanelView {
  if (!remote) return local as PanelView
  if (!local) return remote

  const providers: ProviderView[] = remote.providers.map((provider) => ({
    ...provider,
    sources: [...provider.sources]
  }))
  for (const localProvider of local.providers) {
    const existing = providers.find((provider) => provider.providerId === localProvider.providerId)
    if (!existing) {
      providers.push({ ...localProvider, sources: [...localProvider.sources] })
      continue
    }
    const known = new Set(existing.sources.map((source) => source.sourceId))
    for (const localSource of localProvider.sources) {
      if (!known.has(localSource.sourceId)) existing.sources.push(localSource as SourceView)
    }
  }

  return {
    ...remote,
    providers,
    counts: { ...remote.counts, sources: providers.reduce((total, provider) => total + provider.sources.length, 0) }
  }
}
