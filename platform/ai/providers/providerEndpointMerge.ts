import type { ModelChatProtocol, ModelProvider, ProviderChatEndpoint } from './modelProviderTypes'
import { normalizeModelSupportedProtocols } from './modelChatProtocol'

/**
 * 端点清单的两件纯逻辑（不碰 UI、不碰存储）：
 *
 *  1. `mergeProviderEndpoints` —— **预设 × 用户库**的端点合并；
 *  2. `diffRemovedEndpointProtocols` —— 用户删掉哪个协议（写墓碑）。
 *
 * 分工：
 *  - 端点清单（`ModelProvider.endpoints`）归用户库：用户已有的协议一律保留（地址改过也不覆盖）；
 *  - 预设里新增、用户没配过、也没删过的协议 ⇒ 按预设顺序**追加**到用户清单末尾；
 *  - 用户手动删掉的协议记进 `removedEndpointProtocols`（墓碑），预设合并时跳过它，
 *    否则"每次重启都把删掉的端点加回来"；用户重新添加即清除墓碑。
 *
 * `endpoints[0]` 是默认端点，合并**永远不动它的位置**：用户清单非空时它来自用户清单，
 * 追加只发生在末尾。
 *
 * 前提：两份清单都已归一（`normalizeProviderChatEndpoints` 口径：合法协议、同协议只留第一条）。
 */

/** 合并端点：用户清单原样保留 + 追加预设新增且未删除的协议。 */
export function mergeProviderEndpoints(
  existing: Pick<ModelProvider, 'endpoints' | 'removedEndpointProtocols'>,
  preset: Pick<ModelProvider, 'endpoints'>
): ProviderChatEndpoint[] {
  const tombstoned = new Set(existing.removedEndpointProtocols ?? [])
  const userEndpoints = existing.endpoints ?? []
  // 用户清单为空（新供应商 / 删光端点）⇒ 用预设清单，但**减去**墓碑里的协议，
  // 否则"删光端点的供应商"会被整体复活。
  const base = userEndpoints.length > 0
    ? userEndpoints
    : preset.endpoints.filter((endpoint) => !tombstoned.has(endpoint.protocol))
  // 用户已有的协议一律保留；预设里没被用户配置过、且没被删过的协议，按预设顺序追加。
  return [
    ...base,
    ...preset.endpoints.filter((endpoint) => !base.some((entry) => entry.protocol === endpoint.protocol)
      && !tombstoned.has(endpoint.protocol))
  ]
}

/**
 * 由"旧清单 → 新清单"的差分算出端点墓碑：
 *
 *  - `removed` = 旧清单里有、新清单里没有的协议；
 *  - 新墓碑 = `(旧墓碑 ∪ removed) - 新清单里出现的协议`（重新添加即清除）；
 *  - 空集合 ⇒ `undefined`（保持"没有墓碑"的缺省语义）。
 *
 * 只在存储层的唯一写入点调用（`upsertProvider`），UI 不参与。
 */
export function diffRemovedEndpointProtocols(input: {
  /** 写入前的端点清单（首次创建 = 空）。 */
  previousEndpoints: readonly ProviderChatEndpoint[]
  /** 本次写入的端点清单（整份）。 */
  nextEndpoints: readonly ProviderChatEndpoint[]
  /** 写入前的墓碑。 */
  removedEndpointProtocols?: readonly ModelChatProtocol[]
}): ModelChatProtocol[] | undefined {
  const nextProtocols = new Set(input.nextEndpoints.map((endpoint) => endpoint.protocol))
  const removedNow = input.previousEndpoints
    .map((endpoint) => endpoint.protocol)
    .filter((protocol) => !nextProtocols.has(protocol))
  return normalizeModelSupportedProtocols(
    [...(input.removedEndpointProtocols ?? []), ...removedNow]
      .filter((protocol) => !nextProtocols.has(protocol))
  )
}
