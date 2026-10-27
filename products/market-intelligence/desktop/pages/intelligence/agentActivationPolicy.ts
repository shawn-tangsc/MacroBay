import type { AgentView } from '../../../service/intelligence/application/sourceProjection'

export type ActivationProjection = Readonly<{
  /** 已启用至少一个来源的 provider 数。 */
  enabledSourceCount: number
  /** 可见、非 pending 的 provider 总数；与情报源抽屉的一行对应。 */
  totalSourceCount: number
}>

/**
 * 卡片按“情报源抽屉里的一行”计数：一个 provider 算一个。
 *
 * 只要 provider 下有任意 source 为 enabled，就计入分子——这里表达的是“配置进度”，
 * 不是“健康数据数”；健康/失败状态在来源抽屉里看。
 */
export function projectActivation(agentView: AgentView | undefined): ActivationProjection {
  if (!agentView) return { enabledSourceCount: 0, totalSourceCount: 0 }

  const providers = new Map<string, boolean>()
  for (const group of agentView.groups) {
    for (const source of group.sources) {
      if (source.visibility === 'pending' || source.visibility === 'hidden') continue
      const providerId = source.providerId
      providers.set(providerId, (providers.get(providerId) ?? false) || source.enabled)
    }
  }

  let enabledSourceCount = 0
  for (const enabled of providers.values()) {
    if (enabled) enabledSourceCount += 1
  }

  return {
    enabledSourceCount,
    totalSourceCount: providers.size
  }
}
