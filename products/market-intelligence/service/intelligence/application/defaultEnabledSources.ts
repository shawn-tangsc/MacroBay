import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'

/**
 * 干净安装时默认不打开任何采集源。
 *
 * 示例模式已经提供完整的离线回放，首次启动不该替读者做真实采集决定；
 * 需要的源由读者在「配置看板来源」里逐个开启。
 */
export const DEFAULT_ENABLED_SOURCE_IDS = [] as const

/** 播种只需要「读一条、写一条」；启动时注入真实的 profile store，单测注入内存实现。 */
export type DefaultEnabledSourceStore = {
  getProfile: (sourceId: string) => Promise<IntelligenceSourceProfile | undefined>
  saveProfile: (input: { sourceId: string; enabled: boolean }) => Promise<IntelligenceSourceProfile>
}

/**
 * 只给「还没有 profile」的源写一条 enabled: true。
 *
 * 读者关掉的源会留下一条显式 profile，因此不会被重新打开；反过来说，老安装里第一次出现的源
 * 也按默认打开处理——这正是「默认打开」要覆盖的两条路径。
 */
export async function seedDefaultEnabledSources(store: DefaultEnabledSourceStore): Promise<void> {
  for (const sourceId of DEFAULT_ENABLED_SOURCE_IDS) {
    if ((await store.getProfile(sourceId)) === undefined) {
      await store.saveProfile({ sourceId, enabled: true })
    }
  }
}
