import { Button, Input } from 'antd'
import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import { Modal } from '@platform/ui/components/modal'
import { Tooltip } from '@platform/ui/components/tooltip'
import { useToast } from '@platform/ui/components/toast'
import type { PlatformText } from '../../../i18n/platformText'

const CREATE_ASSISTANT_TITLE_KEY = 'assistants.library.createTitle'
const COMING_SOON_KEY = 'assistants.library.promptGenerateComingSoon'
const PROMPT_GENERATE_TOOLTIP_KEY = 'assistants.library.promptGenerate'

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
  const toast = useToast()
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
      width="standard"
      titleKey={CREATE_ASSISTANT_TITLE_KEY}
      resolveText={(key) => (key === CREATE_ASSISTANT_TITLE_KEY ? labels.createTitle : '')}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button key="cancel" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button key="create" type="primary" loading={submitting} disabled={!canCreate} onClick={() => void submit()}>
            {labels.create}
          </Button>
        </>
      }>
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
          <Tooltip
            labelKey={PROMPT_GENERATE_TOOLTIP_KEY}
            resolveText={(key) => (key === PROMPT_GENERATE_TOOLTIP_KEY ? labels.promptGenerate : '')}>
            <Button
              type="text"
              size="small"
              icon={<Sparkles size={14} />}
              aria-label={labels.promptGenerate}
              onClick={() =>
                toast.info({
                  titleKey: COMING_SOON_KEY,
                  resolveText: (key) => (key === COMING_SOON_KEY ? labels.promptGenerateComingSoon : '')
                })
              }
            />
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
