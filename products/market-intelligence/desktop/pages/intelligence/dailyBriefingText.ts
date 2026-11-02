import type { productText } from '../../shared/i18n/productText'

type DashboardText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']

export type DailyBriefingText = DashboardText['dailyBriefing']

/** The product prefix a `StateView` reason key must carry (contract §17). */
const reasonPrefix = 'mi.dailyBriefing.'

/**
 * Resolves one of this page's reason sentences for `StateView.productReason`.
 *
 * The platform sentence set is generic ("Nothing has ever been created"); the brief's situations are
 * not — "the brief reads only enabled sources" is the part a reader needs. Only the reason slot is
 * overridden; the title, icon and action stay the platform's.
 *
 * Returns an empty string — which makes the component fall back to the platform sentence — when the
 * key is not ours, when the table has no such sentence, or when a `{placeholder}` has no parameter.
 * A half-filled sentence is worse than a generic one: it would print the braces.
 */
export function resolveBriefingStateReason(
  text: DailyBriefingText,
  key: string,
  params?: Readonly<Record<string, string>>
): string {
  if (!key.startsWith(reasonPrefix)) return ''
  const template = (text.stateReasons as Readonly<Record<string, string>>)[key.slice(reasonPrefix.length)]
  if (!template) return ''
  let missing = false
  const sentence = template.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = params?.[name]
    if (!value) {
      missing = true
      return ''
    }
    return value
  })
  return missing ? '' : sentence
}
