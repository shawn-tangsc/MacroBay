import type { WebSearchResponse, WebSearchSearchKeywordsRequest } from '@platform/ai/web-search'

import { createBriefingMacroWebRead, type BriefingMacroWebRead } from './daily-briefing/dailyBriefingMacroWebSource'

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

/**
 * 第二级取值的组装（`A0.12` v2.127）：把"开关 + 授权 + 供应商就绪"合成一个判断，连同平台的
 * 搜索入口一起装成编排要的 `BriefingMacroWebRead`。
 *
 * 三样缺一个就不给 reader——**没给就是一次都不发**，这条在编排层可数。
 * 抽在这里而不是主装配文件里，是因为后者在体积门禁上只减不增。
 */
export function createMacroWebReadFromHooks(input: Readonly<{
  searchWeb?: (request: WebSearchSearchKeywordsRequest) => Promise<Pick<WebSearchResponse, 'results'>>
  getSettingsView: () => Promise<Readonly<{ settings: Readonly<{ webSearchEnabled: boolean; webSearchAuthorizedAt?: string | null }> }>>
  isWebSearchProviderReady?: () => Promise<boolean>
  now?: () => string
}>): BriefingMacroWebRead | undefined {
  if (input.searchWeb === undefined) return undefined
  const searchWeb = input.searchWeb
  return createBriefingMacroWebRead({
    enabled: async () => {
      const view = await input.getSettingsView()
      if (!view.settings.webSearchEnabled) return false
      if (Boolean(view.settings.webSearchAuthorizedAt) === false) return false
      return input.isWebSearchProviderReady === undefined ? true : input.isWebSearchProviderReady()
    },
    searchKeywords: (request) => searchWeb(request),
    ...(input.now === undefined ? {} : { now: input.now })
  })
}

/** 主装配文件体积门禁只减不增：把"读 hooks、装 reader"压成一行调用。 */
export function macroWebReadFromHooks(
  hooks: WebSearchProductHooks | undefined,
  getSettingsView: Parameters<typeof createMacroWebReadFromHooks>[0]['getSettingsView']
): BriefingMacroWebRead | undefined {
  return createMacroWebReadFromHooks({
    ...(hooks?.searchWeb === undefined ? {} : { searchWeb: hooks.searchWeb }),
    getSettingsView,
    ...(hooks?.isWebSearchProviderReady === undefined ? {} : { isWebSearchProviderReady: hooks.isWebSearchProviderReady })
  })
}
