import { Button } from 'antd'
import type { AssistantTemplateCatalogItem } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import { MetaChip } from '@platform/ui/components/meta-chip'
import { StatusPill } from '@platform/ui/components/status-pill'
import type { PlatformText } from '../../../i18n/platformText'

/** 「有更新」是状态词，不是描述标签：药丸只收键，句子由 `labels` 给。 */
const UPDATE_AVAILABLE_KEY = 'assistants.library.updateAvailable'
/** 分类词：模板来源与自带标签。 */
const TEMPLATE_SOURCE_KEY = 'assistants.template.source'
const TEMPLATE_TAG_KEY = 'assistants.template.tag'

/** `kind="text"` 档从不查表——这些是数据，不是句子；签名要求一个解析器，给个空实现。 */
const noopText = (): string => ''

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
          <MetaChip kind="text" text={source} resolveText={noopText} />
          {item.hasUpdate ? (
            <StatusPill
              tone="info"
              labelKey={UPDATE_AVAILABLE_KEY}
              resolveText={(key) => (key === UPDATE_AVAILABLE_KEY ? labels.updateAvailable : '')}
            />
          ) : null}
          {item.tags.slice(0, 2).map((tag) => (
            <MetaChip key={tag} kind="text" text={tag} resolveText={noopText} />
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
