import { describe, expect, it } from 'vitest'

import { DEFAULT_PROBE_TIMEOUT_MS as DIRECT_TIMEOUT_MS } from './createClaudeCodeDirectProbe'
import { DEFAULT_PROBE_TIMEOUT_MS as GATEWAY_TIMEOUT_MS } from './createGatewayProbe'

/**
 * PLAT-62：部分模型（Kimi / GLM 等）首包很慢，探针默认超时从 8s 提到 30s。
 * 超时 ≠ 协议不支持，UI 侧按「暂无法确认」处理。
 */
describe('provider runtime probe timeouts', () => {
  it('uses 30s for both direct and gateway probes', () => {
    expect(DIRECT_TIMEOUT_MS).toBe(30_000)
    expect(GATEWAY_TIMEOUT_MS).toBe(30_000)
  })
})
