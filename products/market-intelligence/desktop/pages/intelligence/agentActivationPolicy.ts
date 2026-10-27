import type { AgentView } from '../../../service/intelligence/application/sourceProjection'

export type ActivationProjection = Readonly<{
  /** 已启用至少一个来源的 provider 数。 */
  enabledSourceCount: number
  /** 可见、非 pending、且参与看板的 provider 总数；与「配置看板来源」抽屉的一行对应。 */
  totalSourceCount: number
}>

/**
 * 卡片按「配置看板来源」抽屉里的一行计数：一个 provider 算一个。
 *
 * 只数 `panels` 含 `dashboard` 的来源——抽屉里看不到的 provider（状态页、监管、官方博客等）
 * 不该进分母，否则读者会看到「12/19」，却在抽屉里怎么都找不到那 7 个。
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
      if (!source.panels.includes('dashboard')) continue
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
