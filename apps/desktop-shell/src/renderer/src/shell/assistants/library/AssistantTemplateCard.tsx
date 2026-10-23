import { Button, Tag } from 'antd'
import type { AssistantTemplateCatalogItem } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import type { PlatformText } from '../../../i18n/platformText'

type AssistantTemplateCardProps = {
  labels: PlatformText['assistants']['library']
  item: AssistantTemplateCatalogItem
  onInstall: (templateId: string) => void
  onOpen: (templateId: string) => void
}

export function AssistantTemplateCard({
  labels,
  item,
  onInstall,
  onOpen
}: AssistantTemplateCardProps): React.ReactElement {
  const source = item.sourceKind === 'product' && item.sourceProductName
    ? labels.sourceProduct(item.sourceProductName)
    : labels.sourcePlatform
  return (
    <article className="assistant-template-card">
      <button
        type="button"
        className="assistant-template-card-preview"
        onClick={() => onOpen(item.templateId)}
        aria-label={item.name}>
        <span className="assistant-template-card-copy">
          <span className="assistant-template-card-title">
            <span className="assistant-template-card-icon">{item.icon}</span>
            <strong>{item.name}</strong>
          </span>
          <small>{item.description || item.promptPreview}</small>
        </span>
        <span className="assistant-template-card-tags">
          <Tag>{source}</Tag>
          {item.hasUpdate ? <Tag color="processing">{labels.updateAvailable}</Tag> : null}
          {item.tags.slice(0, 2).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </span>
      </button>
      <Button
        type={item.installed ? 'text' : 'primary'}
        size="middle"
        disabled={item.installed}
        onClick={() => onInstall(item.templateId)}>
        {item.installed ? labels.installed : labels.install}
      </Button>
    </article>
  )
}
