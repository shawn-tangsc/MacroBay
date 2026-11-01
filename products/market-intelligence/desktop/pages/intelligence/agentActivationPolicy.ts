import type { AgentView } from '../../../service/intelligence/application/sourceProjection'

export type ActivationProjection = Readonly<{
  /** 已启用至少一个来源的 provider 数。 */
  enabledSourceCount: number
  /** 可见、非 pending、且参与看板的 provider 总数；与「配置看板来源」抽屉的一行对应。 */
  totalSourceCount: number
}>

/**
 * What the card may say about its activation read.
 *
 * Three states, and a read that failed is not the same shape as a read that answered with
 * nothing: the first is the system's problem (「暂时读不到」+ 再试一次), the second is the
 * reader's (「还没配置来源」+ 去设置配置). Folding both into `0/0` is what told the reader
 * their setup was empty when we simply could not ask.
 */
export type ActivationState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'ready' } & ActivationProjection>

/**
 * 卡片按「配置看板来源」抽屉里的一行计数：一个 provider 算一个。
 *
 * 只数 `panels` 含 `dashboard` 的来源——抽屉里看不到的 provider（状态页、监管、官方博客等）
 * 不该进分母，否则读者会看到「12/19」，却在抽屉里怎么都找不到那 7 个。
 *
 * 只要 provider 下有任意 source 为 enabled，就计入分子——这里表达的是“配置进度”，
 * 不是“健康数据数”；健康/失败状态在来源抽屉里看。
 *
 * 读失败不经过这里：调用方在拿不到视图时直接给 `unavailable`，不许把「不知道」投影成 0。
 */
export function projectActivation(view: AgentView): ActivationProjection {
  const providers = new Map<string, boolean>()
  for (const group of view.groups) {
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
