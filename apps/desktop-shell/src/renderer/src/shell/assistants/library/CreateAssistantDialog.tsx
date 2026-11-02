import { Button, Input } from 'antd'
import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { useToast } from '@platform/ui/components/toast'
import type { PlatformText } from '../../../i18n/platformText'
import { resolveTextPath, type Path } from '../../../i18n/assistantsTextKey'

const CREATE_ASSISTANT_TITLE_KEY = 'assistants.library.createTitle'
const COMING_SOON_KEY = 'assistants.library.promptGenerateComingSoon'

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
  const resolveAssistantText = (key: string): string => resolveTextPath(labels, key as Path<typeof labels>)
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
          <IconButton
            ariaLabelKey="promptGenerate"
            icon={Sparkles}
            onSelect={() =>
              toast.info({
                titleKey: COMING_SOON_KEY,
                resolveText: (key) => (key === COMING_SOON_KEY ? labels.promptGenerateComingSoon : '')
              })
            }
            resolveText={resolveAssistantText}
            size="md"
            tooltipKey="promptGenerate"
          />
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
