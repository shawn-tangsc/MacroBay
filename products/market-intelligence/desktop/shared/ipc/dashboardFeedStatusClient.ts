import {
  dashboardFeedStatusPublicPolicy,
  parseDashboardFeedStatus,
  type DashboardFeedStatusView
} from '../../../contracts/macro/dashboardFeedStatusContracts'

/** The request carries no arguments; the answer is re-validated on arrival, never trusted. */
export function createDashboardFeedStatusClient(invoke: (productId: string, method: string, payload: unknown) => Promise<unknown> =
  (productId, method, payload) => window.platform.products.invoke(productId, method, payload)) {
  return {
    async query(): Promise<DashboardFeedStatusView> {
      try {
        const result = await invoke('market-intelligence', dashboardFeedStatusPublicPolicy.method, {})
        return parseDashboardFeedStatus(result) ?? unavailable()
      } catch { return unavailable() }
    }
  }
}

function unavailable(): DashboardFeedStatusView {
  return Object.freeze({ state: 'unavailable' as const })
}

export type DashboardFeedStatusClient = ReturnType<typeof createDashboardFeedStatusClient>
