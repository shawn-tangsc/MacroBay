import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import { NEWS_SENTIMENT_SOURCE_IDS } from '../schema/newsSentiment'

/**
 * 干净安装时默认打开的源。
 *
 * 只放「不需要凭据、并且直接决定看板首屏有没有内容」的源：恐惧贪婪卡（Alternative.me）、
 * 资金面卡（DeFiLlama 稳定币）和情绪卡（四个新闻源）。其余源保持关闭，由读者按需打开——
 * 首次启动不替读者做采集决定，但这几张卡片不该要求先手动打开才有数据。
 */
export const DEFAULT_ENABLED_SOURCE_IDS = [
  'alternative-fear-greed',
  'defillama-stablecoins',
  ...NEWS_SENTIMENT_SOURCE_IDS
] as const

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
