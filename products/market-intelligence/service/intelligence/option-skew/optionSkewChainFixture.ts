import type { DeribitOptionInstrument, DeribitOptionQuote } from './optionSkewPolicy'

/**
 * A **synthetic** chain, shaped by the fields the venue documents. It is a fixture, not a recording:
 * the real field names and the unit of `mark_iv` are still unverified (technical design §13.1), so
 * nothing here may be quoted as a real reading.
 *
 * The smile is chosen so both legs land on strikes that bracket 25Δ with room to spare:
 * `iv% = base + 300·ln(K/F)² + (K < F ? 8 : 0)` — puts carry the protection premium.
 */
export const OPTION_SKEW_FIXTURE_NOW_MS = Date.parse('2026-11-22T07:00:00.000Z')
export const OPTION_SKEW_FIXTURE_FORWARD = 90_000
const DAY_MS = 86_400_000
const STRIKES = [60_000, 70_000, 75_000, 80_000, 85_000, 90_000, 95_000, 100_000, 105_000, 110_000, 120_000]

export type OptionSkewChainFixture = {
  instruments: DeribitOptionInstrument[]
  quotes: DeribitOptionQuote[]
}

export function buildOptionSkewChainFixture(input?: {
  nowMs?: number
  forward?: number
  /** Expiries in days from `nowMs`, with the base vol of each. */
  expiriesInDays?: readonly number[]
  baseVols?: readonly number[]
}): OptionSkewChainFixture {
  const nowMs = input?.nowMs ?? OPTION_SKEW_FIXTURE_NOW_MS
  const forward = input?.forward ?? OPTION_SKEW_FIXTURE_FORWARD
  const expiries = input?.expiriesInDays ?? [25, 40]
  const baseVols = input?.baseVols ?? [52, 50]
  const instruments: DeribitOptionInstrument[] = []
  const quotes: DeribitOptionQuote[] = []

  expiries.forEach((days, expiryIndex) => {
    const expiryMs = nowMs + days * DAY_MS
    const base = baseVols[expiryIndex] ?? 50
    for (const strike of STRIKES) {
      for (const optionType of ['put', 'call'] as const) {
        const name = `BTC-${new Date(expiryMs).toISOString().slice(0, 10)}-${strike}-${optionType === 'put' ? 'P' : 'C'}`
        instruments.push({ instrumentName: name, expiryMs, strike, optionType })
        const moneyness = Math.log(strike / forward)
        const markIv = base + 300 * moneyness * moneyness + (strike < forward ? 8 : 0)
        quotes.push({
          instrumentName: name,
          markIv: Math.round(markIv * 100) / 100,
          bidPrice: 0.01,
          askPrice: 100_000,
          openInterest: 10,
          underlyingPrice: forward
        })
      }
    }
  })

  return { instruments, quotes }
}