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
 * The product owner decision is that every source updates without a manual step,
 * so a provider is enabled on boot when it is genuinely usable. The gate is
 * deliberately narrow:
 *
 * - only credential-free providers are auto-enabled, because enabling a provider
 *   that still needs a key would only produce failing requests;
 * - a provider whose runtime dependency is missing at composition time (for
 *   example no evidence archive for BLS, or no BEA release refresh) is never
 *   enabled, so auto-enrollment can never advertise a capability that cannot run;
 * - an already-enabled provider is left untouched, including its `updatedAt`, so
 *   this is not a settings migration and cannot undo a user's explicit choice to
 *   disable something that is still listed as ready by the caller.
 */
export const macroCalendarProviderAutoEnrollmentPolicy = Object.freeze({
  autoEnabledProviders: credentialFreeCalendarProviders,
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
