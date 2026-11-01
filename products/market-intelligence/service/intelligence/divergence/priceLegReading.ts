import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'

/**
 * The divergence card's price leg: the 24-hour return at the newest close the store can answer.
 *
 * The snapshot anchors its closed returns at `floor(asOf)`. For the first seconds after every
 * five-minute boundary the bar closing exactly then is not written yet, so a read at the current
 * instant answers "no 24-hour return" — while the price card, which reads the newest closed bar,
 * shows a number. Two cards contradicting each other on one page is worse than a five-minute-old
 * reading, so the leg steps back until a close exists, and reports which close it used.
 *
 * The step-back is bounded: past half an hour the leg is not "a little old", it is a source that
 * stopped, and the card should say the comparison could not be made.
 */
export const priceLegStepBackMs = Object.freeze([0, 5 * 60_000, 10 * 60_000, 15 * 60_000, 25 * 60_000])

export type PriceLegReading = Readonly<{ return24hPercent: number; observedAt: string }>

export type ClosedReturnSnapshotReader = (input: Readonly<{ range: '24h'; asOf: string }>) => Promise<CrossAssetSnapshot | undefined>

/**
 * Reads the leg, and throws when the read itself failed.
 *
 * The difference matters downstream: a thrown read becomes "we could not ask" on the card, while an
 * empty answer stays "the market gave nothing". Collapsing both into `undefined` was what made the
 * card say "no price" while the price card was showing one.
 */
export function createPriceLegReader(read: ClosedReturnSnapshotReader) {
  return async (asOf: string): Promise<PriceLegReading | undefined> => {
    let answered = false
    let fault: unknown
    for (const stepBack of priceLegStepBackMs) {
      const at = new Date(Date.parse(asOf) - stepBack).toISOString()
      let snapshot: CrossAssetSnapshot | undefined
      try {
        snapshot = await read({ range: '24h', asOf: at })
      } catch (error) {
        fault ??= error
        continue
      }
      if (!snapshot) continue
      answered = true
      const metric = snapshot.closedReturns.btc['24h']
      if (metric.state === 'available') return { return24hPercent: metric.value, observedAt: snapshot.analysisEnd }
    }
    // Not one snapshot came back: the reader is unreachable, which is a fault rather than "flat".
    if (!answered) throw fault ?? new Error('cross-asset snapshot unavailable')
    return undefined
  }
}
