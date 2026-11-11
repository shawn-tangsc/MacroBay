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
        return parseDashboardFeedStatus(result) ?? unavailable('parse-failed')
      } catch { return unavailable('ipc-failed') }
    }
  }
}

function unavailable(reason: 'ipc-failed' | 'parse-failed'): DashboardFeedStatusView {
  // `reason` 只用于诊断（DevTools / 日志），渲染层不做任何判断。
  return Object.freeze({ state: 'unavailable' as const, reason })
}

export type DashboardFeedStatusClient = ReturnType<typeof createDashboardFeedStatusClient>
