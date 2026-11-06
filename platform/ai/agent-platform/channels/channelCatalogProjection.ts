/**
 * 适配器目录 → 设置页要的目录行（纯函数）。
 *
 * 单独成文件是为了让 `ChannelManagementService` 留在 500 行硬线内：这段不碰仓储、不碰副作用，
 * 输入是注册表条目，输出是读者能看到的四列（状态、原因、是否实现、凭据字段）。
 */
import type { ChannelManagementCatalogEntry } from './ChannelManagementContracts'
import { channelAdapterDescriptor } from './channelAdapterDescriptors'
import { channelAdapterKeyForType } from './ChannelManagementPredicates'
import type { ChannelAdapterAcceptanceEntry } from './channelContracts'

export function projectChannelCatalog(
  entries: readonly ChannelAdapterAcceptanceEntry[]
): ChannelManagementCatalogEntry[] {
  return entries.map((entry) => {
    const descriptor = channelAdapterDescriptor(channelAdapterKeyForType(entry.adapterType))
    return {
      type: entry.adapterType,
      status: entry.status === 'supported' ? 'supported' : entry.status === 'planned' ? 'planned' : 'blocked',
      reason: entry.status === 'supported' ? 'evidence-complete' : entry.status === 'planned' ? 'release-a-pending' : 'adapter-blocked',
      implemented: descriptor.implemented,
      credentialFields: descriptor.credentialFields
    }
  })
}
