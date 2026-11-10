import type { SafeModelProvider } from './modelProviderTypes'
import { isProviderConnectionReady } from './providerStore'

/**
 * 模型服务是否已配置：**至少一个供应商三件齐**（已启用 + 端点有地址 + 运行时 API Key）。
 *
 * 判据不在这里另写：直接组合 `isProviderConnectionReady`（内部是 `ProviderReadinessPolicy.isReady`，
 * 与 `resolveChatModel` 挑 "ready provider" 用的是同一个函数）。这里只把「任意一个」这一层抽出来，
 * 供只读视图复用——读者拿到的只有「已配置 / 未配置」这一档，不暴露 key，也不暴露供应商列表。
 */
export function isModelServiceConfigured(providers: readonly SafeModelProvider[]): boolean {
  return providers.some((provider) => isProviderConnectionReady(provider))
}
