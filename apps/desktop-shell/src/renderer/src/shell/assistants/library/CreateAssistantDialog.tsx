import { Button, Input, Modal, Tooltip } from 'antd'
import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { PlatformText } from '../../../i18n/platformText'

type CreateAssistantDialogProps = {
  labels: PlatformText['assistants']['library']
  open: boolean
  onClose: () => void
  onCreate: (input: CreateAssistantDto) => Promise<void>
}

export function CreateAssistantDialog({
  labels,
  open,
  onClose,
  onCreate
}: CreateAssistantDialogProps): React.ReactElement {
  const [icon, setIcon] = useState('💬')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const tokenCount = useMemo(() => Math.ceil(prompt.trim().length / 4), [prompt])
  const canCreate = Boolean(name.trim() && prompt.trim())

  async function submit(): Promise<void> {
    if (!canCreate) return
    setSubmitting(true)
    try {
      await onCreate({
        name,
        prompt,
        icon,
        contextSourceIds: []
      })
      setIcon('💬')
      setName('')
      setPrompt('')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={labels.createTitle}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {labels.cancel}
        </Button>,
        <Button key="create" type="primary" loading={submitting} disabled={!canCreate} onClick={() => void submit()}>
          {labels.create}
        </Button>
      ]}>
      <div className="assistant-create-dialog">
        <label>
          <span>{labels.icon}</span>
          <Input value={icon} maxLength={4} onChange={(event) => setIcon(event.target.value)} />
        </label>
        <label>
          <span>{labels.name}</span>
          <Input value={name} placeholder={labels.namePlaceholder} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>{labels.prompt}</span>
          <Input.TextArea
            value={prompt}
            placeholder={labels.promptPlaceholder}
            autoSize={{ minRows: 7, maxRows: 12 }}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="assistant-create-dialog-meta">
          <Tooltip title={labels.promptGenerate}>
            <Button type="text" size="small" disabled icon={<Sparkles size={14} />} aria-label={labels.promptGenerate} />
          </Tooltip>
          <span>{labels.tokenCount(tokenCount)}</span>
        </div>
        <label>
          <span>{labels.knowledgeBase}</span>
          <Input value={labels.knowledgeBaseDisabled} disabled />
        </label>
      </div>
    </Modal>
  )
}
