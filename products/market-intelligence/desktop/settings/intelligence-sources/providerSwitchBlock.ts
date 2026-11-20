/**
 * Why the provider-level collection switch is not operable, if it is not.
 *
 * The switch edits `profile.enabled`, but what the product actually runs is `resolveRuntimeConfig`,
 * and a source with `collection: 'none'` is never armed by it. Two truths for one control is how a
 * switch ends up showing "on" for something that never runs — so the switch reads the reason from
 * here and stops being clickable, instead of a default value hiding the mismatch once.
 */
export type ProviderSwitchBlock = Readonly<{ ariaKey: string; labelKey: string }>

export function providerSwitchBlock(input: Readonly<{
  pending: boolean
  credentialMissing: boolean
}>): ProviderSwitchBlock | undefined {
  if (input.pending) {
    return {
      ariaKey: 'settings.intelligenceSources.providerPendingAria',
      labelKey: 'settings.intelligenceSources.providerPending'
    }
  }
  if (input.credentialMissing) {
    return {
      ariaKey: 'settings.intelligenceSources.credentialRequiredToEnableAria',
      labelKey: 'settings.intelligenceSources.credentialRequiredToEnable'
    }
  }
  return undefined
}
