import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'

/**
 * The ETF reading's own refresh cadence, declared once and keyed on its source id.
 *
 * Ten minutes, unchanged from the source it replaces: the reading is a daily series, but the
 * collector also has to notice the moment today's row settles, and the vendor's free tier is
 * 60 requests a minute while we spend two per round. A generic preset must not decide this — a
 * reader switching the preset to `manual` would otherwise silently stop the reading.
 */
export const cryptoEtfRefreshSchedulePolicy = Object.freeze({
  sourceId: cryptoEtfSourcePolicy.sourceId,
  collectionPreset: 'balanced' as const,
  intervalSeconds: 10 * 60
})
