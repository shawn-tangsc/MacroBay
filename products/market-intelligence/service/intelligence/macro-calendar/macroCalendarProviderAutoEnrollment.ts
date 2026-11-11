import type { MacroCalendarProviderId } from './macroCalendarContracts'
import type { MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'

/**
 * Providers that need no API credential: the Fed schedule/statement feeds, the BEA
 * release feed and the in-process BLS Python bridge. Kept in the type system as a
 * literal list so a future credentialed provider cannot be enabled by accident.
 */
export const credentialFreeCalendarProviders = ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'] as const
export type CredentialFreeCalendarProvider = typeof credentialFreeCalendarProviders[number]

/**
 * Automatic provider enrollment policy.
 *
 * 读者 2026-11-12：美联储（Fed）与美国经济分析局（BEA）两个官方日历**默认启动**——
 * 「Fed 和 BEA 这两个默认启动」。BLS 一并留着（它自己按就绪判断走）。
 *
 * 三条策略语义没有变，这是这段代码存在的理由：
 * - 只对**已经装好运行时依赖**的 provider 生效（`readyProviderIds`），缺依赖的那次启动不会把它
 *   写成「开着但从不刷新」；
 * - 写入**只从关到开**：读者手动关掉的 provider **不会被翻回去**（下次启动也不会）；
 * - 幂等：已经是开的就不写。
 *
 * **已知缺口（如实记，别照上面第二条下结论）**：档案里只有 `enabled`，没有「这是读者关掉的」标记，
 * 所以自动列表里的 provider（今天包括 Fed / BEA / BLS）在读者手动关掉之后，**下一次启动会被重新打开**。
 * 要真正兑现第二条，需要给档案加一个「开关属于读者」的标记——属存储变更，等架构裁定，别在这里猜。
 */
export const macroCalendarProviderAutoEnrollmentPolicy = Object.freeze({
  autoEnabledProviders: ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'] as readonly CredentialFreeCalendarProvider[],
  /** The policy is idempotent: it only flips `enabled` from false to true. */
  enableOnlyWhenDisabled: true
})

export function isCredentialFreeCalendarProvider(providerId: MacroCalendarProviderId): providerId is CredentialFreeCalendarProvider {
  return (credentialFreeCalendarProviders as readonly string[]).includes(providerId)
}

/**
 * Enables every credential-free provider that is ready for the current boot and
 * currently disabled. Returns the provider ids it changed, so the caller can log
 * a bounded, credential-free summary.
 */
export async function autoEnrollCalendarProviders(deps: Readonly<{
  profiles: Pick<MacroCalendarProviderProfileStore, 'list' | 'save'>
  /** Providers whose runtime dependencies were composed successfully this boot. */
  readyProviderIds: readonly MacroCalendarProviderId[]
}>): Promise<readonly MacroCalendarProviderId[]> {
  const ready = new Set(deps.readyProviderIds)
  const enabled: MacroCalendarProviderId[] = []
  let current: readonly { providerId: MacroCalendarProviderId; enabled: boolean; decidedBy?: 'auto' | 'reader' }[]
  try {
    current = await deps.profiles.list()
  } catch {
    return []
  }
  for (const providerId of macroCalendarProviderAutoEnrollmentPolicy.autoEnabledProviders) {
    if (!ready.has(providerId)) continue
    const profile = current.find(candidate => candidate.providerId === providerId)
    // 只从关到开，且**不碰读者自己决定的开关**：读者关掉的 provider 下次启动也不许被翻回去。
    if (profile?.enabled === true || profile?.decidedBy === 'reader') continue
    try {
      await deps.profiles.save({ providerId, enabled: true, decidedBy: 'auto' })
      enabled.push(providerId)
    } catch {
      // A single failing write must not block the other providers.
    }
  }
  return enabled
}
