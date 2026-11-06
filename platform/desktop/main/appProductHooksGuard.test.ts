import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 宿主入口的守卫（`A0.12` 第三步）。
 *
 * `app.ts` 是平台受保护边界：这一笔只允许**增加一个只读搜索入口**。所以这里钉两件事——
 * 入口确实接到了平台的 `WebSearchService.searchKeywords`，且既有那几个产品侧 handler 一个都没丢。
 * 任何一次「顺手整理」把 handler 拿走，这条会先红。
 */
const source = readFileSync(join(process.cwd(), 'platform/desktop/main/app.ts'), 'utf8')
// 产品侧的接线搬到了 `productAgentPlatformWiring.ts`：入口还在，只是换了个文件写。
const wiringSource = readFileSync(join(process.cwd(), 'platform/desktop/main/productAgentPlatformWiring.ts'), 'utf8')

describe('the host exposes exactly one extra read-only search entry', () => {
  it('forwards the product-side search to the platform web search service', () => {
    // 只读入口：必须是透传到已有实例，不许在这里新建服务、不许写设置。
    expect(wiringSource).toContain('searchWeb: (request) => webSearchService.searchKeywords(request)')
    expect(source).not.toContain('searchWeb: (request) => createWebSearchService')
  })

  it('keeps every product-side handler that was already wired', () => {
    for (const handler of [
      // 接线搬到模块之后这一行写成了「从 source 取」的形式，接的仍是同一个平台判据。
      'isWebSearchProviderReady: source.isAgentWebSearchProviderReady',
      'invokeProductAgentTool: (state, input) => source.productAgentToolRuntimeService.invokeTool(state, input)',
      'invokeProductIpc: (productId, method, payload) => source.productIpcRegistry.invoke(productId, method, payload)',
      'registerProductAgentToolHandler',
      'platformFetch: getPlatformFetch()'
    ]) {
      expect(`${source}\n${wiringSource}`, handler).toContain(handler)
    }
  })
})
