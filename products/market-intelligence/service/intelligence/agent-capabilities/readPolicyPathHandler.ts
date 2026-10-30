import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import type { ReadHandlerDeps } from './readHandlerContracts'

/**
 * The policy reading as an agent tool answer.
 *
 * It is a projection of the same read the panel uses, so a model and the reader cannot disagree
 * about the number; the caveats carry the two things a model must not over-read: the odds are a
 * market price, and the projections belong to the latest meeting that published them.
 */
export async function handleGetPolicyPath(input: unknown, deps: ReadHandlerDeps): Promise<unknown> {
  const { asOf } = (input ?? {}) as { asOf?: unknown }
  if (typeof asOf !== 'string' || Number.isNaN(Date.parse(asOf))) {
    return { state: 'unavailable', failureCode: 'as-of-invalid', caveats: [] }
  }
  const reading = deps.policyPath?.read({ asOf }) as PolicyPathReading | undefined
  if (!reading) return { state: 'unavailable', failureCode: 'meeting-not-found', caveats: [] }
  const caveats = ['odds-are-market-pricing']
  if (reading.sep) caveats.push('projections-from-latest-sep-meeting')
  if (reading.probability && reading.probability.changeInPp24h === undefined) caveats.push('twenty-four-hour-change-not-yet-available')
  // The panel's shape and its transient conclusions are excluded from the analysis snapshot by
  // design: the same sentence would mean something else a day later, so the model gets the facts
  // (the meeting, the range, the odds) and none of the clock-derived panel state.
  const { phase: _phase, markers: _markers, ...facts } = reading
  return { state: 'available', asOf, meetingDate: reading.meetingDate, reading: facts, caveats }
}
