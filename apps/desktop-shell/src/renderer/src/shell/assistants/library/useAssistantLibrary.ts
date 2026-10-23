import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AssistantTemplateCatalogItem,
  AssistantTemplateDetail,
  AssistantTemplateGroupId,
  AssistantTemplateGroupView
} from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

export type AssistantLibraryProductGroup = {
  id: string
  name: string
  count: number
}

export const defaultAssistantLibraryGroup: AssistantTemplateGroupId = 'general'

export function useAssistantLibrary(language: AppLanguage): {
  items: AssistantTemplateCatalogItem[]
  groups: AssistantTemplateGroupView[]
  productGroups: AssistantLibraryProductGroup[]
  selectedGroup: AssistantTemplateGroupId
  selectedProductId: string | null
  search: string
  loading: boolean
  error: string | null
  setSelectedGroup: (group: AssistantTemplateGroupId) => void
  setSelectedProductId: (productId: string | null) => void
  setSearch: (search: string) => void
  refresh: () => Promise<void>
  getTemplateDetail: (templateId: string) => Promise<AssistantTemplateDetail | null>
  installTemplate: (templateId: string) => Promise<void>
  createAssistant: (input: CreateAssistantDto) => Promise<void>
} {
  const [items, setItems] = useState<AssistantTemplateCatalogItem[]>([])
  const [groups, setGroups] = useState<AssistantTemplateGroupView[]>([])
  const [allItems, setAllItems] = useState<AssistantTemplateCatalogItem[]>([])
  const [selectedGroup, setSelectedGroupState] = useState<AssistantTemplateGroupId>(defaultAssistantLibraryGroup)
  const [selectedProductId, setSelectedProductIdState] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(
    () => ({
      group: selectedProductId ? undefined : selectedGroup,
      search
    }),
    [search, selectedGroup, selectedProductId]
  )

  const productGroups = useMemo(() => buildProductGroups(allItems), [allItems])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextItems, nextGroups, nextAllItems] = await Promise.all([
        window.platform.assistants.library.listTemplates(query, language),
        window.platform.assistants.library.listGroups(language),
        window.platform.assistants.library.listTemplates({}, language)
      ])
      const catalogItems = nextItems as AssistantTemplateCatalogItem[]
      const productScopedItems = selectedProductId
        ? ((nextAllItems as AssistantTemplateCatalogItem[]).filter(
            (item) =>
              item.sourceKind === 'product' &&
              item.sourceProductId === selectedProductId &&
              matchesSearch(item, search)
          ))
        : catalogItems
      setItems(productScopedItems)
      setGroups(nextGroups as AssistantTemplateGroupView[])
      setAllItems(nextAllItems as AssistantTemplateCatalogItem[])
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [language, query, selectedProductId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setSelectedGroup = useCallback((group: AssistantTemplateGroupId) => {
    setSelectedProductIdState(null)
    setSelectedGroupState(group)
  }, [])

  const setSelectedProductId = useCallback((productId: string | null) => {
    setSelectedProductIdState(productId)
  }, [])

  const getTemplateDetail = useCallback(
    async (templateId: string) => {
      return (await window.platform.assistants.library.getTemplate(templateId, language)) as AssistantTemplateDetail | null
    },
    [language]
  )

  const installTemplate = useCallback(
    async (templateId: string) => {
      await window.platform.assistants.library.installTemplate({ templateId }, language)
      await refresh()
    },
    [language, refresh]
  )

  const createAssistant = useCallback(
    async (input: CreateAssistantDto) => {
      await window.platform.assistants.library.createAssistant(input)
      await refresh()
    },
    [refresh]
  )

  return {
    items,
    groups,
    productGroups,
    selectedGroup,
    selectedProductId,
    search,
    loading,
    error,
    setSelectedGroup,
    setSelectedProductId,
    setSearch,
    refresh,
    getTemplateDetail,
    installTemplate,
    createAssistant
  }
}

function matchesSearch(item: AssistantTemplateCatalogItem, search: string): boolean {
  const keyword = search.trim().toLowerCase()
  if (!keyword) return true
  return [
    item.name,
    item.description,
    item.promptPreview,
    item.sourceProductName ?? '',
    ...item.groups,
    ...item.tags
  ]
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}

export function buildProductGroups(items: AssistantTemplateCatalogItem[]): AssistantLibraryProductGroup[] {
  const groups = new Map<string, AssistantLibraryProductGroup>()
  for (const item of items) {
    if (item.sourceKind !== 'product' || !item.sourceProductId) continue
    const existing = groups.get(item.sourceProductId)
    if (existing) {
      existing.count += 1
      continue
    }
    groups.set(item.sourceProductId, {
      id: item.sourceProductId,
      name: item.sourceProductName || item.sourceProductId,
      count: 1
    })
  }
  return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name))
}
