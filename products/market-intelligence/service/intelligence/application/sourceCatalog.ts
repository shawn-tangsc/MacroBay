import type { IntelligenceSourceCatalogEntry, IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import { attachSourceApplicability } from './sourceCatalogApplicability'
import { macroMarketCatalogEntries } from './sourceCatalogEntriesMacroMarket'
import { newsCryptoCatalogEntries } from './sourceCatalogEntriesNewsCrypto'

/**
 * 情报源目录：**条目数据在 `sourceCatalogEntries*` 两个文件里**（按「新闻/加密」与「宏观/日历」分组），
 * 这里只负责把它们合起来、并给出查询接口。加一个源＝往对应那组加一条，不用动本文件。
 */
const catalog: IntelligenceSourceCatalogEntry[] = [
  ...newsCryptoCatalogEntries,
  ...macroMarketCatalogEntries
]

export const defillamaStablecoinRetiredPathPolicy = Object.freeze({
  sourceId: 'defillama-stablecoins'
})

export function isDefillamaStablecoinRetiredPath(sourceId: string): boolean {
  return sourceId === defillamaStablecoinRetiredPathPolicy.sourceId
}

export function listIntelligenceSourceDefinitions(): IntelligenceSourceDefinition[] {
  return catalog.map((entry) => attachSourceApplicability({ ...entry, adapterConfig: { ...entry.adapterConfig } }))
}

export function getIntelligenceSourceDefinition(sourceId: string): IntelligenceSourceDefinition | undefined {
  const definition = catalog.find((entry) => entry.sourceId === sourceId)
  return definition
    ? attachSourceApplicability({ ...definition, adapterConfig: { ...definition.adapterConfig } })
    : undefined
}
