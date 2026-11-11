import type {
  IntelligenceRuntimeValidationIssue,
  IntelligenceSourceConfig,
  IntelligenceSourceProfile
} from '../schema/intelligenceSource'

export const sourceRuntimeEligibilityParityPolicy = {
  normalizeCredentialReference(value?: string): string {
    return value?.trim() ?? ''
  },
  isEligible(config: IntelligenceSourceConfig, issues: readonly IntelligenceRuntimeValidationIssue[]): boolean {
    return config.enabled && issues.length === 0
  }
} as const

const sourceRuntimeReconcileIdempotencyPolicy = {
  issueFieldFallback: ''
} as const

export function canonicalRuntimeFingerprint(input: {
  sourceId: string
  profile: IntelligenceSourceProfile
  config: IntelligenceSourceConfig
  issues: readonly IntelligenceRuntimeValidationIssue[]
}): string {
  return stableJson({
    sourceId: input.sourceId,
    profileRevision: input.profile.updatedAt,
    // 读者存下来的开关本身就是运行时决定的一部分：产品自有作业（宏观市场、DXY）只读这个布尔，
    // 而它们的 `config.enabled` 恒为 false。只看 `config.enabled` 时，两次保存落在同一毫秒
    // （`updatedAt` 相同）会让指纹也相同，于是「刚打开」被当成没变化、作业不再排期。
    profileEnabled: input.profile.enabled === true,
    enabled: input.config.enabled,
    desiredRuntimeState: input.config.desiredRuntimeState,
    collectionPreset: input.config.collectionPreset,
    pollingIntervalSec: input.config.pollingIntervalSec,
    credentialRef: sourceRuntimeEligibilityParityPolicy.normalizeCredentialReference(input.profile.credentialRef),
    adapterConfig: input.config.adapterConfig,
    issues: input.issues.map(({ code, field }) => ({
      code,
      field: field ?? sourceRuntimeReconcileIdempotencyPolicy.issueFieldFallback
    }))
  })
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value))
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortCanonicalValue(entry)])
  )
}
