import type { PlatformText } from '../../i18n/platformText'

/**
 * PLAT-62：供应商显示名走 i18n；不收录的品牌回退持久化 name。
 *
 * 参数只取 `providerNames`：选择器数据层只需要这一张表，避免为了一个名字把整组文案传下去。
 */
export function resolveProviderDisplayName(
  labels: Pick<PlatformText['models'], 'providerNames'>,
  provider: { id: string; name: string }
): string {
  return labels.providerNames[provider.id] ?? provider.name
}
