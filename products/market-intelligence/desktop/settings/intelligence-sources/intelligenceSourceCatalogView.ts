type SourceEnabledProfile = {
  sourceId: string
  enabled: boolean
}

export function buildSourceEnabledById(
  sourceIds: readonly string[],
  profiles: readonly SourceEnabledProfile[],
  draftProfile?: SourceEnabledProfile
): Record<string, boolean> {
  const visibleSourceIds = new Set(sourceIds)
  const enabledBySourceId: Record<string, boolean> = {}

  for (const sourceId of sourceIds) {
    enabledBySourceId[sourceId] = false
  }

  for (const profile of profiles) {
    if (visibleSourceIds.has(profile.sourceId)) {
      enabledBySourceId[profile.sourceId] = profile.enabled
    }
  }

  if (draftProfile && visibleSourceIds.has(draftProfile.sourceId)) {
    enabledBySourceId[draftProfile.sourceId] = draftProfile.enabled
  }

  return enabledBySourceId
}
