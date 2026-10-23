import { isBuiltInSettingsPanelId } from './builtInNavEntries'

export type SettingsPanelEntry = {
  id: string
}

/**
 * Resolves the settings panel key from a `#settings/<slug>` hash.
 *
 * Product pages link with a short, product-local slug (for example
 * `exchange-connections`). The shell must not know which product owns that
 * slug, so the key is resolved against the generated settings registry:
 *
 * 1. a built-in panel id is used as-is;
 * 2. a full product-qualified id is used as-is;
 * 3. a short slug resolves only when exactly one registered panel id ends with
 *    `.<slug>`, which keeps the lookup deterministic when two products reuse a
 *    local id.
 */
export function resolveSettingsPanelKeyFromHash(
  slug: string,
  entries: readonly SettingsPanelEntry[]
): string {
  const value = slug.trim()
  if (!value) {
    return value
  }

  if (isBuiltInSettingsPanelId(value)) {
    return value
  }

  if (entries.some((entry) => entry.id === value)) {
    return value
  }

  const suffix = `.${value}`
  const matches = entries.filter((entry) => entry.id.endsWith(suffix))
  return matches.length === 1 ? matches[0].id : value
}

export const DEFAULT_SETTINGS_PANEL_ID = 'models'

/**
 * Falls back to the default panel when the requested key is not registered in
 * this build (for example a persisted `#settings/channels` link after the
 * channel feature was disabled). The settings pane must never render blank.
 */
export function resolveAvailableSettingsPanelKey(
  requested: string,
  entries: readonly SettingsPanelEntry[],
  fallback: string = DEFAULT_SETTINGS_PANEL_ID
): string {
  if (isBuiltInSettingsPanelId(requested)) {
    return requested
  }

  if (entries.some((entry) => entry.id === requested)) {
    return requested
  }

  return fallback
}
