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
  /** 首次读取失败。没有它，「读不到」会被画成「被筛选挡住了」——把没读到说成筛选的错。 */
  loadFailed: boolean
  onRetry: () => void
}

export function AssistantTemplateGrid({
  labels,
  items,
  loading,
  loadingLabel,
  onInstall,
  onOpen,
  onClearFilters,
  loadFailed,
  onRetry
}: AssistantTemplateGridProps): React.ReactElement {
  if (loading) {
    return (
      <div className="assistant-library-empty">
        <LoadingState label={loadingLabel} />
      </div>
    )
  }

  if (loadFailed && items.length === 0) {
    return (
      <div className="assistant-library-empty">
        <StateView
          state="error"
          reasonCode="unavailable"
          size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }}
        />
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
