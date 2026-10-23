import { useState } from 'react'
import { ChevronDown, ChevronRight, Network, Plus, Search } from 'lucide-react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import {
  PROVIDER_CATEGORY_ORDER,
  PROVIDER_REFERRAL_INACTIVE_IDS,
  providerCategoryOf,
  providerIsRecommended,
  providerReachabilityOf,
  providerReferralRank,
  type ProviderCategoryId
} from '@platform/ai/providers/providerPresets'
import { resolveProviderVisual } from '@platform/ui/icons/modelProviderVisuals'

import type { PlatformText } from '../../i18n/platformText'
import { VisualIdentityAvatar } from '../VisualIdentityAvatar'
import { resolveProviderDisplayName } from './providerDisplayName'
import { ProviderRowContextMenu } from './ProviderRowContextMenu'

/**
 * PLAT-61：左栏供应商列表。
 *
 * 只有搜索 + 行 + 底部「＋ 添加」；行状态用**状态点**（启用=accent，未启用=灰）表达，
 * 不再出现 ON 文字徽标（启用开关只保留在右栏标题行，见 ModelServiceProviderPage）。
 *
 * 分组：已启用 → 推荐 → 分类；组内排序只影响渲染顺序：
 * 选中态由 `selectedProviderId` 决定，重排不会改变选中项或右侧详情。
 */
/**
 * 分类组 / 已启用组的组内排序：**① 已启用 → ② 源顺序**（稳定分区）。
 * 邀请推荐不再影响分类顺序 —— 推荐只体现在独立「推荐」组里。
 */
export function arrangeProvidersForRail<T extends { enabled: boolean }>(providers: readonly T[]): T[] {
  return [...providers.filter((provider) => provider.enabled), ...providers.filter((provider) => !provider.enabled)]
}

export type ProviderRailGroupId = ProviderCategoryId | 'pinned' | 'recommended'

export type ProviderRailGroup<T> = {
  id: ProviderRailGroupId
  providers: T[]
}

/**
 * 左栏组顺序：已启用 → 推荐 → 5 个分类组。
 * 空组不渲染；顺序固定，不随启用状态/搜索跳动。
 */
export const RAIL_GROUP_ORDER: readonly ProviderRailGroupId[] = [
  'pinned',
  'recommended',
  ...PROVIDER_CATEGORY_ORDER
]

/**
 * 按「已启用 → 推荐 → 分类」固定分组。
 *
 * - `pinned`：全部已启用（与分类组重复展示）；
 * - `recommended`：**未启用**且同时有邀请链接与明确奖励规则的供应商，按奖励规则好坏排序；
 *   一旦启用就只留在 `pinned`，从推荐组消失；
 * - 分类组：已启用优先，组内保持源顺序。
 * **空组直接丢弃**：非搜索态是 0 个供应商，搜索态是 0 命中，两种情况下都不渲染组头。
 */
export function groupProvidersForRail<T extends { id: string; enabled: boolean }>(
  providers: readonly T[],
  inactiveReferralIds: readonly string[] = PROVIDER_REFERRAL_INACTIVE_IDS
): ProviderRailGroup<T>[] {
  const byCategory = new Map<ProviderCategoryId, T[]>()
  for (const provider of providers) {
    const category = providerCategoryOf(provider.id)
    const bucket = byCategory.get(category)
    if (bucket) bucket.push(provider)
    else byCategory.set(category, [provider])
  }

  const groups: ProviderRailGroup<T>[] = []
  const pinned = arrangeProvidersForRail(providers.filter((provider) => provider.enabled))
  if (pinned.length > 0) groups.push({ id: 'pinned', providers: pinned })

  const rankOf = (provider: T): number => providerReferralRank(provider.id) ?? Number.MAX_SAFE_INTEGER
  const recommended = providers
    .filter((provider) => !provider.enabled && providerIsRecommended(provider.id, inactiveReferralIds))
    .sort((left, right) => rankOf(left) - rankOf(right))
  if (recommended.length > 0) groups.push({ id: 'recommended', providers: recommended })

  for (const category of PROVIDER_CATEGORY_ORDER) {
    const groupProviders = arrangeProvidersForRail(byCategory.get(category) ?? [])
    if (groupProviders.length > 0) groups.push({ id: category, providers: groupProviders })
  }
  return groups
}

/**
 * 左栏第一行（第一个非空分组的第一个供应商）的 id —— 默认选中的唯一依据。
 *
 * 注意：不能直接用 `providers[0]`。源数组顺序不是视觉顺序：
 * 已启用（pinned）→ 推荐（按奖励排名）→ 分类（组内已启用优先），
 * 所以默认选中必须走与渲染完全相同的分组结果。
 */
export function firstProviderIdForRail<T extends { id: string; enabled: boolean }>(
  providers: readonly T[],
  inactiveReferralIds: readonly string[] = PROVIDER_REFERRAL_INACTIVE_IDS
): string | null {
  return groupProvidersForRail(providers, inactiveReferralIds)[0]?.providers[0]?.id ?? null
}

type ModelServiceProviderRailProps = {
  labels: PlatformText['models']
  providers: readonly SafeModelProvider[]
  totalProviderCount: number
  selectedProviderId: string | null
  search: string
  onSearchChange: (value: string) => void
  onSelect: (providerId: string) => void
  onAdd: () => void
  onToggleProvider?: (provider: SafeModelProvider) => void
  onDeleteProvider?: (provider: SafeModelProvider) => void
  /** 覆盖 `PROVIDER_REFERRAL_INACTIVE_IDS`（默认读取平台清单；用于下线联动/测试注入）。 */
  inactiveReferralIds?: readonly string[]
}

export function ModelServiceProviderRail({
  labels,
  providers,
  totalProviderCount,
  selectedProviderId,
  search,
  onSearchChange,
  onSelect,
  onAdd,
  onToggleProvider = () => undefined,
  onDeleteProvider = () => undefined,
  inactiveReferralIds = PROVIDER_REFERRAL_INACTIVE_IDS
}: ModelServiceProviderRailProps): React.ReactElement {
  // PLAT-62：折叠状态只存内存（不写设置、不持久化），重启后全部展开。
  const [collapsedGroups, setCollapsedGroups] = useState<readonly ProviderRailGroupId[]>([])
  const groups = groupProvidersForRail(providers, inactiveReferralIds)
  const isSearching = search.trim().length > 0
  const emptyText = totalProviderCount === 0 && !isSearching ? labels.noProviders : labels.noMatchedProviders

  function toggleGroup(groupId: ProviderRailGroupId): void {
    setCollapsedGroups((previous) =>
      previous.includes(groupId) ? previous.filter((item) => item !== groupId) : [...previous, groupId]
    )
  }

  function labelForGroup(groupId: ProviderRailGroupId): string {
    if (groupId === 'pinned') return labels.enabledProviders
    if (groupId === 'recommended') return labels.recommendedProviders
    return labels.providerCategories[groupId]
  }

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; provider: SafeModelProvider } | null>(null)

  return (
    <aside className="model-service-rail" data-model-provider-rail>
      <label className="model-service-rail-search">
        <Search size={14} aria-hidden="true" />
        <input
          data-provider-search
          type="search"
          value={search}
          placeholder={labels.searchProviderPlaceholder}
          aria-label={labels.searchProvider}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      <div className="model-service-rail-list">
        {groups.length === 0 ? <p className="model-service-rail-empty">{emptyText}</p> : null}
        {groups.map((group) => {
          const label = labelForGroup(group.id)
          const collapsed = collapsedGroups.includes(group.id)
          const toggleLabel = collapsed ? labels.expandProviderGroup : labels.collapseProviderGroup

          return (
            <div key={group.id} className="model-service-rail-group" data-provider-group={group.id}>
              <button
                type="button"
                className="model-service-rail-group-header"
                data-provider-group-header
                data-provider-group={group.id}
                aria-expanded={!collapsed}
                title={toggleLabel}
                aria-label={`${label} · ${group.providers.length}`}
                onClick={() => toggleGroup(group.id)}>
                {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                <span className="model-service-rail-group-name">{label}</span>
                <span className="model-service-rail-group-count" data-provider-group-count>
                  {group.providers.length}
                </span>
              </button>

              {collapsed
                ? null
                : group.providers.map((provider) => {
                    const displayName = resolveProviderDisplayName(labels, provider)
                    const statusLabel = provider.enabled ? labels.providerEnabled : labels.providerDisabled
                    // PLAT-62 追加：可达性只做行内提示（proxy 用网络图标），不改行结构/行高。
                    const reachability = providerReachabilityOf(provider.id)
                    const reachabilityLabel =
                      reachability === 'proxy' ? labels.reachabilityProxy : labels.reachabilityDirect
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        data-provider-row={provider.id}
                        data-provider-group={group.id}
                        data-reachability={reachability}
                        className={provider.id === selectedProviderId ? 'model-service-rail-row active' : 'model-service-rail-row'}
                        aria-current={provider.id === selectedProviderId}
                        title={`${displayName}${displayName === provider.name ? '' : ` (${provider.name})`} · ${reachabilityLabel}`}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setContextMenu({ x: event.clientX, y: event.clientY, provider })
                        }}
                        onClick={() => onSelect(provider.id)}>
                        <VisualIdentityAvatar visual={resolveProviderVisual(provider.id, provider.name)} size={22} />
                        <span className="model-service-rail-name">{displayName}</span>
                        {reachability === 'proxy' ? (
                          <span
                            data-provider-reachability-icon
                            aria-hidden="true"
                            title={reachabilityLabel}
                            style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', color: 'var(--muted)' }}>
                            <Network size={12} aria-hidden="true" />
                          </span>
                        ) : null}
                        <span
                          data-provider-status-dot
                          className={provider.enabled ? 'model-service-rail-dot enabled' : 'model-service-rail-dot'}
                          title={statusLabel}
                          aria-label={statusLabel}
                        />
                      </button>
                    )
                  })}
            </div>
          )
        })}
      </div>

      <ProviderRowContextMenu
        menu={contextMenu}
        labels={labels}
        onClose={() => setContextMenu(null)}
        onOpen={onSelect}
        onToggle={onToggleProvider}
        onDelete={onDeleteProvider}
      />

      <button
        type="button"
        className="model-service-rail-add"
        data-provider-add
        title={labels.addProvider}
        aria-label={labels.addProvider}
        onClick={onAdd}>
        <Plus size={14} aria-hidden="true" />
        {labels.addProviderAction}
      </button>
    </aside>
  )
}
