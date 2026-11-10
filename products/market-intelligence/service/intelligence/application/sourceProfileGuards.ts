const dashboardScheduleProfilePolicy = {
  requiredFields: [
    'profileId', 'sourceId', 'enabled', 'collectionPreset', 'includeInSentiment', 'scopePolicy',
    'rawArchiveEnabled', 'retentionMode', 'autoReplayAfterParserUpgrade', 'updatedAt'
  ],
  optionalFields: ['credentialRef', 'monitoredSymbols', 'sourceSpecificConfigJson'],
  scopePolicies: ['all', 'watchlist-priority', 'active-position-priority'],
  retentionModes: ['compact', 'balanced', 'extended']
} as const

export function isExactProfile(value: unknown): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    const allowedFields = [...dashboardScheduleProfilePolicy.requiredFields, ...dashboardScheduleProfilePolicy.optionalFields]
    if (!dashboardScheduleProfilePolicy.requiredFields.every((field) => names.includes(field)) ||
      !names.every((name) => allowedFields.includes(name as never)) || Object.getOwnPropertySymbols(value).length !== 0) return false
    const values = new Map<string, unknown>()
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!descriptor || !('value' in descriptor)) return false
      values.set(name, descriptor.value)
    }
    structuredClone(value)
    return typeof values.get('profileId') === 'string' &&
      typeof values.get('sourceId') === 'string' &&
      typeof values.get('enabled') === 'boolean' &&
      isCollectionPresetValue(values.get('collectionPreset')) &&
      typeof values.get('includeInSentiment') === 'boolean' &&
      dashboardScheduleProfilePolicy.scopePolicies.includes(values.get('scopePolicy') as never) &&
      typeof values.get('rawArchiveEnabled') === 'boolean' &&
      dashboardScheduleProfilePolicy.retentionModes.includes(values.get('retentionMode') as never) &&
      typeof values.get('autoReplayAfterParserUpgrade') === 'boolean' &&
      typeof values.get('updatedAt') === 'string' &&
      isOptionalString(values.get('credentialRef')) &&
      isOptionalString(values.get('sourceSpecificConfigJson')) &&
      isOptionalStringArray(values.get('monitoredSymbols'))
  } catch {
    return false
  }
}

export function isCollectionPresetValue(value: unknown): value is 'manual' | 'balanced' | 'frequent' {
  return value === 'manual' || value === 'balanced' || value === 'frequent'
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

export function isOptionalStringArray(value: unknown): value is string[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return false
  const names = Object.getOwnPropertyNames(value)
  if (!names.filter((name) => name !== 'length').every((name) => /^\d+$/.test(name))) return false
  if (!names.filter((name) => name !== 'length').every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return Boolean(descriptor && 'value' in descriptor && typeof descriptor.value === 'string')
  })) return false
  try {
    structuredClone(value)
    return true
  } catch {
    return false
  }
}
