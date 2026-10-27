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
 * Demo mode supplies the first screen, so a fresh install starts with every
 * real collection source disabled. The policy intentionally auto-enables no
 * provider; readers opt in from the source drawer.
 */
export const macroCalendarProviderAutoEnrollmentPolicy = Object.freeze({
  autoEnabledProviders: [] as readonly CredentialFreeCalendarProvider[],
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
  let current: readonly { providerId: MacroCalendarProviderId; enabled: boolean }[]
  try {
    current = await deps.profiles.list()
  } catch {
    return []
  }
  for (const providerId of macroCalendarProviderAutoEnrollmentPolicy.autoEnabledProviders) {
    if (!ready.has(providerId)) continue
    const profile = current.find(candidate => candidate.providerId === providerId)
    if (profile?.enabled === true) continue
    try {
      await deps.profiles.save({ providerId, enabled: true })
      enabled.push(providerId)
    } catch {
      // A single failing write must not block the other providers.
    }
  }
  return enabled
}
