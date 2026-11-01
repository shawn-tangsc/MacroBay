import { Empty } from 'antd'
import type { AssistantTemplateCatalogItem } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import { EmptyState } from '@platform/ui/components/empty-state'
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
}

export function AssistantTemplateGrid({
  labels,
  items,
  loading,
  loadingLabel,
  onInstall,
  onOpen
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
        <EmptyState
          icon={Empty.PRESENTED_IMAGE_DEFAULT}
          title={labels.emptyTitle}
          reason={labels.emptyDescription}
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
