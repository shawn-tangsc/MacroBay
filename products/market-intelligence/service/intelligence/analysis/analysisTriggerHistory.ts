import type { TriggerHistoryEntry } from './analysisTriggerPolicy'
import { isGateEligible, phaseForNewTriggerKey } from './analysisTriggerSourcePolicy'

/**
 * Maps a ledger row to the history `analysisTriggerPolicy` reasons about.
 *
 * Only the keys this plan introduces map to `correction`: they must not feed the item path's
 * phase cooldown or move its review-window start. Every pre-existing key keeps today's mapping
 * exactly, including `manual.*` — those rows genuinely reach the ledger (recovery records
 * them), and re-phasing them would silently let item triggers fire earlier.
 */
export function toTriggerHistory(value: { triggerKey: string; createdAt: string }): TriggerHistoryEntry {
  if (isGateEligible(value.triggerKey)) return { phase: phaseForNewTriggerKey(value.triggerKey), triggeredAt: value.createdAt }
  return { phase: value.triggerKey === 'market-reaction.15m' ? 'review' : 'initial', triggeredAt: value.createdAt }
}
