import type { WebSearchResponse, WebSearchSearchKeywordsRequest } from '@platform/ai/web-search'

/**
 * 宿主给产品侧的「联网搜索」两个口子（`A0.12` 第三步）。
 *
 * 抽成一个小类型文件，是因为主装配文件在体积门禁上是「只减不增」——两条新口子不该把它顶红。
 *
 * - `isWebSearchProviderReady`：供应商是否就绪（原有）；
 * - `searchWeb`：只读搜索透传，日报缺实际值时按平台既定开关/授权/代理搜一次。
 *   只读、不写设置、不新增 IPC 方法；产品侧不自己发请求。
 */
export type WebSearchProductHooks = Readonly<{
  isWebSearchProviderReady?: () => Promise<boolean>
  searchWeb?: (request: WebSearchSearchKeywordsRequest) => Promise<Pick<WebSearchResponse, 'results'>>
}>
