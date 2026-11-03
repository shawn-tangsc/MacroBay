import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The interface-language fallback, as a state line on the brief page.
 *
 * The settings dialog keeps the same sentence inside its question mark; here it is the reason the
 * page is in another language, so it stays visible (the state must be readable, never hidden behind
 * a trigger). It renders nothing when the interface language is supported, so no empty live region
 * announces silence.
 */
export function DailyBriefingLanguageFallback({ requested, text }: Readonly<{
  /** The interface language the reader asked for; `null` when it is supported. */
  requested: string | null
  text: DailyBriefingText
}>): React.ReactElement | null {
  if (!requested) return null
  const language = (text.settings.languageNames as Readonly<Record<string, string>>)[requested] ?? requested
  return <p className="mi-daily-briefing-page__language-fallback" role="status">
    {text.settings.periods.languageUnsupported.replace('{language}', language)}
  </p>
}
