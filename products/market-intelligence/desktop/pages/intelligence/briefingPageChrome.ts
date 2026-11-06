import type { DailyBriefingDocument, DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { briefingTextForLocale } from './dailyBriefingText'
import type { DailyBriefingText } from './dailyBriefingText'
import { posterProps } from './dailyBriefingPoster'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'

/**
 * The page's own chrome facts: body class, poster, the edition's text/locale, and which settings
 * opener to use. Extracted so the page component stays under its size ceiling; behaviour is a plain
 * copy of what it computed inline.
 */
export function briefingPageChrome(input: Readonly<{
  onOpenModelSettings?: (() => void) | undefined
  readyDocument: DailyBriefingDocument | undefined
  editions: readonly DailyBriefingEditionSummary[]
  text: DailyBriefingText
  locale: DailyBriefingLocale
}>): Readonly<{
  openModelService: () => void
  bodyClass: string
  poster: ReturnType<typeof posterProps>
  editionText: DailyBriefingText
  editionLocale: DailyBriefingLocale
}> {
  return {
    openModelService: input.onOpenModelSettings ?? openModelSettings,
    // The grid never changes shape, so the body does not jump when an edition appears.
    bodyClass: 'mi-daily-briefing-page__body mi-daily-briefing-page__body--with-appendix',
    poster: posterProps({ document: input.readyDocument, editions: input.editions, fallbackText: input.text }),
    // Content follows the edition, chrome follows the interface.
    editionText: input.readyDocument ? briefingTextForLocale(input.readyDocument.edition.locale) : input.text,
    editionLocale: input.readyDocument?.edition.locale ?? input.locale
  }
}
