import { productText } from '../../../shared/i18n/productText'

/**
 * The calendar page's own copy.
 *
 * It lives beside the page rather than inside it so the month-result seam and the page's
 * components can name the same type without importing the page back.
 */
export type EconomicCalendarText = (typeof productText)[keyof typeof productText]['pages']['intelligence']['portal']['calendar']
