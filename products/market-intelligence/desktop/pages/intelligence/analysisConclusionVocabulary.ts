import { analysisConclusionLocale, type MarketAnalysisReadableNames } from '../../../contracts/marketAnalysisReadableText'
import { productText } from '../../shared/i18n/productText'

/**
 * The vocabulary a published conclusion is read with.
 *
 * The model writes the conclusion in Chinese (see `analysisModelPrompt.ts`), so the prose is
 * always named from the Chinese registry whatever the UI language is: `稳定币Current` would be
 * worse than either language alone. Reading it once here — rather than drilling it through every
 * surface — is what keeps the latest-conclusion card, the timeline entry and the node detail
 * from naming the same field differently. The structured change list beside a conclusion is
 * chrome and follows the reader's locale instead.
 */
export const conclusionReadableNames: MarketAnalysisReadableNames =
  productText[analysisConclusionLocale].pages.intelligence.portal.analysisWorkspace.readableNames
