import { Empty, Spin } from 'antd'
import type { AssistantTemplateCatalogItem } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import type { PlatformText } from '../../../i18n/platformText'
import { AssistantTemplateCard } from './AssistantTemplateCard'

type AssistantTemplateGridProps = {
  labels: PlatformText['assistants']['library']
  items: AssistantTemplateCatalogItem[]
  loading: boolean
  onInstall: (templateId: string) => void
  onOpen: (templateId: string) => void
}

export function AssistantTemplateGrid({
  labels,
  items,
  loading,
  onInstall,
  onOpen
}: AssistantTemplateGridProps): React.ReactElement {
  if (loading) {
    return (
      <div className="assistant-library-empty">
        <Spin />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="assistant-library-empty">
        <Empty description={labels.emptyTitle} />
        <p>{labels.emptyDescription}</p>
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
