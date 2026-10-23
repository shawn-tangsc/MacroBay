import { Button, Modal, Tag } from 'antd'
import type { AssistantTemplateDetail } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import type { PlatformText } from '../../../i18n/platformText'

type AssistantTemplateDetailDialogProps = {
  labels: PlatformText['assistants']['library']
  template: AssistantTemplateDetail | null
  open: boolean
  installing: boolean
  onClose: () => void
  onInstall: (templateId: string) => void
}

export function AssistantTemplateDetailDialog({
  labels,
  template,
  open,
  installing,
  onClose,
  onInstall
}: AssistantTemplateDetailDialogProps): React.ReactElement {
  const source = template
    ? template.sourceKind === 'product' && template.sourceProductName
      ? labels.sourceProduct(template.sourceProductName)
      : labels.sourcePlatform
    : ''

  return (
    <Modal
      className="assistant-template-detail-modal"
      title={template?.name ?? labels.title}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {labels.cancel}
        </Button>,
        <Button
          key="install"
          type="primary"
          loading={installing}
          disabled={!template || template.installed}
          onClick={() => template && onInstall(template.templateId)}>
          {template?.installed ? labels.installed : labels.addToAssistant}
        </Button>
      ]}>
      {template ? (
        <div className="assistant-template-detail">
          <div className="assistant-template-detail-summary">
            <span className="assistant-template-detail-icon">{template.icon}</span>
            <div>
              <p>{template.description || template.promptPreview}</p>
              <div className="assistant-template-detail-tags">
                <Tag>{source}</Tag>
                {template.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            </div>
          </div>
          <section className="assistant-template-detail-prompt" aria-label={labels.detailPromptTitle}>
            <h3>{labels.detailPromptTitle}</h3>
            <pre>{template.prompt}</pre>
          </section>
        </div>
      ) : null}
    </Modal>
  )
}
