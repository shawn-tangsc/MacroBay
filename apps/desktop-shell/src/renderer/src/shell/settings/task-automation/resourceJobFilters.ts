import type { JobScheduleView } from '@platform/jobs'

export type ResourceJobSourceFilter = 'all' | 'platform' | `product:${string}`

export type ResourceJobRegistrationFilter = 'all' | 'registered' | 'unregistered'

export type ResourceJobFilters = {
  nameQuery: string
  source: ResourceJobSourceFilter
  registration: ResourceJobRegistrationFilter
}

export type ResourceJobSourceOption = {
  value: ResourceJobSourceFilter
  kind: 'all' | 'platform' | 'product'
  productId: string | null
}

/**
 * 来源下拉完全由投影 distinct 生成（平台 + 实际出现的产品），不硬编码任何产品名/产品 id。
 * 顺序 = 首次出现顺序，便于用户按注册顺序理解。
 */
export function buildResourceJobSourceOptions(
  items: readonly Pick<JobScheduleView, 'owner' | 'productId'>[]
): ResourceJobSourceOption[] {
  const options: ResourceJobSourceOption[] = [
    { value: 'all', kind: 'all', productId: null },
    { value: 'platform', kind: 'platform', productId: null }
  ]
  const seen = new Set<string>()
  for (const item of items) {
    if (item.owner !== 'product' || !item.productId || seen.has(item.productId)) continue
    seen.add(item.productId)
    options.push({ value: `product:${item.productId}`, kind: 'product', productId: item.productId })
  }
  return options
}

export type ResourceJobSourceSelectOption = {
  value: ResourceJobSourceFilter
  label: string
  /** 悬停可看全名，配合不截断的弹层。 */
  title: string
}

/** 把来源投影映射成下拉选项；产品名缺失时回退产品 id，选项文本永远完整。 */
export function buildResourceJobSourceSelectOptions(
  options: readonly ResourceJobSourceOption[],
  labels: { allSources: string; platform: string; product: string },
  productNames: Record<string, string>
): ResourceJobSourceSelectOption[] {
  return options.map((option) => {
    const label = option.kind === 'all'
      ? labels.allSources
      : option.kind === 'platform'
        ? labels.platform
        : productNames[option.productId ?? ''] ?? option.productId ?? labels.product
    return { value: option.value, label, title: label }
  })
}

export function filterResourceJobs(  items: readonly JobScheduleView[],
  filters: ResourceJobFilters
): JobScheduleView[] {
  const query = filters.nameQuery.trim().toLowerCase()
  return items.filter((item) => {
    if (query && !item.title.toLowerCase().includes(query)) return false
    if (filters.source === 'platform' && item.owner !== 'platform') return false
    if (filters.source.startsWith('product:') && item.productId !== filters.source.slice('product:'.length)) return false
    if (filters.registration === 'registered' && !item.registered) return false
    if (filters.registration === 'unregistered' && item.registered) return false
    return true
  })
}
