import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import {
  isMacroMarketSnapshotQuery,
  macroMarketSnapshotPublicPolicy,
  parseMacroMarketSnapshot,
  type MacroMarketSnapshotView
} from '../../../../contracts/macro/macroMarketSnapshotContracts'
import {
  dashboardFeedStatusPublicPolicy,
  isDashboardFeedStatusQuery,
  parseDashboardFeedStatus
} from '../../../../contracts/macro/dashboardFeedStatusContracts'
import type { DashboardFeedStatusQuery } from '../dashboardFeedStatusQuery'
import type { MacroMarketSnapshot } from '../macroMarketSnapshotQuery'

const productId = 'market-intelligence'

/**
 * Read-only door for the macro-market snapshot. The stored series come from the snapshot query;
 * `readiness` supplies the one fact the store cannot know — whether the source is enabled and
 * keyed — so the dashboard can tell "waiting for the first collection" from "switched off".
 */
export type MacroMarketSnapshotIpcQuery = Readonly<{
  snapshot: () => MacroMarketSnapshot
  readiness: () => Promise<Readonly<{ enabled: boolean; hasCredential: boolean }>>
}>

/**
 * The handler validates the empty request, re-parses the service's own snapshot through the
 * product boundary, and collapses every failure to `unavailable` — the dashboard must show 未接入
 * rather than a stale or invented level.
 */
export function registerMacroMarketIpc(register: ProductIpcRegistrar, query: MacroMarketSnapshotIpcQuery): void {
  register(productId, macroMarketSnapshotPublicPolicy.method, async payload => {
    try {
      if (!isMacroMarketSnapshotQuery(payload)) return unavailable()
      const snapshot = query.snapshot()
      const readiness = await query.readiness()
      return parseMacroMarketSnapshot({
        ...snapshot,
        source: { enabled: readiness?.enabled === true, hasCredential: readiness?.hasCredential === true }
      }) ?? unavailable()
    } catch {
      return unavailable()
    }
  })
}

function unavailable(): MacroMarketSnapshotView {
  return Object.freeze({ state: 'unavailable' as const })
}

/**
 * The door behind the 来源状态 strip's per-feed lines. It answers with the reader's own switches (the
 * profile and the credential store) plus the collection's own verdict, and re-parses its own answer
 * through the public boundary — so a source that is not configured, not enabled, or has just failed
 * reaches the strip as that, and never as a working source.
 */
export function registerDashboardFeedStatusIpc(
  register: ProductIpcRegistrar,
  query: Pick<DashboardFeedStatusQuery, 'status'>
): void {
  register('market-intelligence', dashboardFeedStatusPublicPolicy.method, async payload => {
    try {
      if (!isDashboardFeedStatusQuery(payload)) return feedStatusUnavailable()
      return parseDashboardFeedStatus({ state: 'available', sources: await query.status() }) ?? feedStatusUnavailable()
    } catch {
      return feedStatusUnavailable()
    }
  })
}

function feedStatusUnavailable() {
  return Object.freeze({ state: 'unavailable' as const })
}
