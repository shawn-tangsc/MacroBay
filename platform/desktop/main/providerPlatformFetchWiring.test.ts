import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PLAT-61 回归守卫：主进程所有 provider 出站都必须注入平台 fetch（Electron net.fetch + session 代理）。
 * 覆盖：连接检测、模型同步、运行时兼容性检查（普通聊天 lane）。聊天链路的既有注入也必须保留。
 */
const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('PLAT-61 provider platform fetch wiring', () => {
  const appSource = read('platform/desktop/main/app.ts')

  it('injects the platform fetch into the provider connection probe', () => {
    expect(appSource).toMatch(
      /testModelProviderConnection\(provider,\s*\{[\s\S]{0,200}?fetch:\s*getPlatformFetch\(\)/
    )
  })

  it('injects the platform fetch into the model sync preview', () => {
    expect(appSource).toMatch(
      /previewProviderModelSync\(provider,\s*\{\s*fetch:\s*getPlatformFetch\(\)\s*\}/
    )
  })

  it('keeps the platform fetch injection for runtime checks and the chat chain', () => {
    const injections = appSource.match(/getPlatformFetch\(\)/g) ?? []
    // runtime check service + probe service + web search + 聊天链路（>=2）至少 5 处。
    expect(injections.length).toBeGreaterThanOrEqual(5)
    expect(appSource).toContain('probeService: agentModelRuntimeProbeService')
  })

  it('passes the injected fetch through the runtime check service', () => {
    const service = read('platform/desktop/main/agentModelCompatibility/ProviderRuntimeCheckService.ts')
    expect(service).toMatch(/testModelProviderConnection\(providerForCheck,\s*\{[\s\S]{0,120}?fetch:\s*this\.deps\.fetch/)
  })
})
