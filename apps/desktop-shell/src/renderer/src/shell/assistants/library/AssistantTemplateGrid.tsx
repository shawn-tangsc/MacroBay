import type { AssistantTemplateCatalogItem } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { LoadingState } from '@platform/ui/components/loading'
import type { PlatformText } from '../../../i18n/platformText'
import { AssistantTemplateCard } from './AssistantTemplateCard'

type AssistantTemplateGridProps = {
  labels: PlatformText['assistants']['library']
  items: AssistantTemplateCatalogItem[]
  loading: boolean
  /** The catalog read's own copy; the grid never writes a second loading sentence. */
  loadingLabel: string
  onInstall: (templateId: string) => void
  onOpen: (templateId: string) => void
  /** 空列表来自筛选（分类 / 关键词）：给一个真的能回到全量的动作。 */
  onClearFilters: () => void
}

export function AssistantTemplateGrid({
  labels,
  items,
  loading,
  loadingLabel,
  onInstall,
  onOpen,
  onClearFilters
}: AssistantTemplateGridProps): React.ReactElement {
  if (loading) {
    return (
      <div className="assistant-library-empty">
        <LoadingState label={loadingLabel} />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="assistant-library-empty">
        <StateView
          state="empty"
          reasonCode="filtered-out"
          size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.clear_filter, onSelect: onClearFilters }}
        />
      </div>
    )
  }

  return (
    <div className="assistant-template-grid">
      {items.map((item) => (
        <AssistantTemplateCard
          key={item.templateId}
          labels={labels}
          item={item}
          onInstall={onInstall}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
