import { Button, Input, message } from 'antd'
import { useState } from 'react'
import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import { Modal } from '@platform/ui/components/modal'
import type { PlatformText } from '../../../i18n/platformText'
import { parseAssistantImportJson } from './assistantImportTransfer'

const IMPORT_ASSISTANT_TITLE_KEY = 'assistants.library.importTitle'

type ImportAssistantDialogProps = {
  labels: PlatformText['assistants']['library']
  open: boolean
  onClose: () => void
  onImport: (input: CreateAssistantDto) => Promise<void>
}

export function ImportAssistantDialog({
  labels,
  open,
  onClose,
  onImport
}: ImportAssistantDialogProps): React.ReactElement {
  const [rawJson, setRawJson] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function importJson(): Promise<void> {
    setSubmitting(true)
    try {
      const assistants = parseAssistantImportJson(rawJson)
      for (const assistant of assistants) {
        await onImport(assistant)
      }
      message.success(labels.importSuccess(assistants.length))
      setRawJson('')
      onClose()
    } catch {
      message.error(labels.importFailed)
    } finally {
      setSubmitting(false)
    }
  }

  async function readClipboard(): Promise<void> {
    const text = await navigator.clipboard.readText()
    setRawJson(text)
  }

  async function selectFile(): Promise<void> {
    const files = (await window.platform.app.selectFiles()) as string[]
    const file = files[0]
    if (!file) return
    const result = (await window.platform.app.readTextFile(file)) as { text?: string }
    setRawJson(result.text ?? '')
  }

  return (
    <Modal
      width="standard"
      titleKey={IMPORT_ASSISTANT_TITLE_KEY}
      resolveText={(key) => (key === IMPORT_ASSISTANT_TITLE_KEY ? labels.importTitle : '')}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button key="cancel" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button
            key="import"
            type="primary"
            loading={submitting}
            disabled={!rawJson.trim()}
            onClick={() => void importJson()}>
            {labels.importSubmit}
          </Button>
        </>
      }>
      <div className="assistant-import-dialog">
        <div className="assistant-import-actions">
          <Button onClick={() => void selectFile()}>{labels.importFile}</Button>
          <Button onClick={() => void readClipboard()}>{labels.importClipboard}</Button>
        </div>
        <label>
          <span>{labels.importJson}</span>
          <Input.TextArea
            value={rawJson}
            placeholder={labels.importJsonPlaceholder}
            autoSize={{ minRows: 8, maxRows: 14 }}
            onChange={(event) => setRawJson(event.target.value)}
          />
        </label>
        <p>{labels.importUrlDisabled}</p>
      </div>
    </Modal>
  )
}
