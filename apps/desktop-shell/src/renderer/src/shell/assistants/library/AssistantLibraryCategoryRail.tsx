import { Boxes } from 'lucide-react'
import type { AssistantTemplateGroupId, AssistantTemplateGroupView } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import type { PlatformText } from '../../../i18n/platformText'
import type { AssistantLibraryProductGroup } from './useAssistantLibrary'
import { assistantLibraryGroups } from './assistantLibraryGroups'

type AssistantLibraryCategoryRailProps = {
  labels: PlatformText['assistants']['library']
  groups: AssistantTemplateGroupView[]
  selectedGroup: AssistantTemplateGroupId
  productGroups: AssistantLibraryProductGroup[]
  selectedProductId: string | null
  onSelectGroup: (group: AssistantTemplateGroupId) => void
  onSelectProduct: (productId: string) => void
}

export function AssistantLibraryCategoryRail({
  labels,
  groups,
  selectedGroup,
  productGroups,
  selectedProductId,
  onSelectGroup,
  onSelectProduct
}: AssistantLibraryCategoryRailProps): React.ReactElement {
  const counts = new Map(groups.map((group) => [group.id, group.count]))
  return (
    <aside className="assistant-library-rail" aria-label={labels.title}>
      <div className="assistant-library-rail-section">
        {assistantLibraryGroups.map((group) => {
          const Icon = group.icon
          const count = counts.get(group.id) ?? 0
          const active = !selectedProductId && selectedGroup === group.id
          return (
            <button
              key={group.id}
              type="button"
              className={active ? 'assistant-library-rail-item active' : 'assistant-library-rail-item'}
              onClick={() => onSelectGroup(group.id)}>
              <Icon size={17} />
              <span>{labels.groups[group.id]}</span>
              <small>{count}</small>
            </button>
          )
        })}
      </div>
      {productGroups.length ? (
        <div className="assistant-library-rail-section">
          <div className="assistant-library-rail-heading">{labels.productGroupsTitle}</div>
          {productGroups.map((product) => (
            <button
              key={product.id}
              type="button"
              className={selectedProductId === product.id ? 'assistant-library-rail-item active' : 'assistant-library-rail-item'}
              onClick={() => onSelectProduct(product.id)}>
              <Boxes size={17} />
              <span>{product.name}</span>
              <small>{product.count}</small>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
