import type { IntelligenceModulePlatformHooks } from './intelligenceModule'

/**
 * Hooks whose value is a runtime instance, not a per-call closure: a repeat call that rebinds one is
 * a wiring bug. The other hooks are callbacks the caller rebuilds every call, so comparing those by
 * identity would reject legitimate repeats.
 */
export const singletonHookFields = ['platformFetch', 'eventBusRuntime', 'createPlatformWebSocket'] as const

/** The first singleton hook a repeat call tries to rebind, or `null` when nothing conflicts. */
export function firstReboundSingletonHook(
  next: IntelligenceModulePlatformHooks | undefined,
  bound: IntelligenceModulePlatformHooks | undefined
): (typeof singletonHookFields)[number] | null {
  if (!next) return null
  for (const field of singletonHookFields) {
    const supplied = next[field]
    if (supplied !== undefined && bound?.[field] !== undefined && supplied !== bound[field]) return field
  }
  return null
}
