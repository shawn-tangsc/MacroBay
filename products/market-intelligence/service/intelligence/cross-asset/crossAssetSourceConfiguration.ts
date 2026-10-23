import { crossAssetPolicy } from './crossAssetPolicy'

export function createCrossAssetSourceConfiguration(deps: {
  profileStore: { getProfile: (sourceId: string) => Promise<unknown>; resolveProfile: (sourceId: string) => Promise<unknown> }
}) {
  return { async read(): Promise<{ state: 'configured' | 'default'; enabled: boolean } | { state: 'unknown' }> {
    try {
      const saved = await deps.profileStore.getProfile(crossAssetPolicy.sourceId)
      const profile = saved === undefined ? await deps.profileStore.resolveProfile(crossAssetPolicy.sourceId) : saved
      if (!profile || typeof profile !== 'object' || !('sourceId' in profile) || profile.sourceId !== crossAssetPolicy.sourceId ||
        !('enabled' in profile) || typeof profile.enabled !== 'boolean') return { state: 'unknown' }
      return { state: saved === undefined ? 'default' : 'configured', enabled: profile.enabled }
    } catch { return { state: 'unknown' } }
  } }
}
