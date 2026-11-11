/**
 * 采集策略那几行的文案形状（从已删除的详情块里留下的一份**类型**）。
 *
 * 界面入口已经搬走（采集预设 → 采集与数据每源第二行；纳入情绪 → 同一行），
 * 但 `ProviderDetail` / `SourceConfigSurface` 的 `policy` 入参仍按这个形状由宿主给，
 * 所以类型留在这里一处，不跟着组件一起消失。
 */
export type CollectionPolicyLabels = {
  title: string
  collectionPreset: string
  manualPresetNote: string
  includeInSentiment: string
  /** 收起态头行那枚短标（这组现在不能改）；空/没给就不挂。 */
  stoppedBadge?: string
  presets: Record<string, string>
}

export type CollectionPolicyNotConfigurable = Readonly<{ ariaLabelKey: string; labelKey: string }>
