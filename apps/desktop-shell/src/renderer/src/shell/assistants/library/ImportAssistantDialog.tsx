import { Button, Input } from 'antd'
import { useState } from 'react'
import type { CreateAssistantDto } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import { Modal } from '@platform/ui/components/modal'
import { useToast } from '@platform/ui/components/toast'
import type { PlatformText } from '../../../i18n/platformText'
import { parseAssistantImportJson } from './assistantImportTransfer'

const IMPORT_ASSISTANT_TITLE_KEY = 'assistants.library.importTitle'

type ImportAssistantDialogProps = {
  labels: PlatformText['assistants']['library']
  open: boolean
  onClose: () => void
  onImport: (input: CreateAssistantDto) => Promise<void>
}

/** 导入回执的键；句子仍在 `platformText.assistants.library`。 */
const IMPORT_SUCCESS_KEY = 'assistants.library.importSuccess'
const IMPORT_FAILED_KEY = 'assistants.library.importFailed'

export function ImportAssistantDialog({
  labels,
  open,
  onClose,
  onImport
}: ImportAssistantDialogProps): React.ReactElement {
  const toast = useToast()
  const [rawJson, setRawJson] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function importJson(): Promise<void> {
    setSubmitting(true)
    try {
      const assistants = parseAssistantImportJson(rawJson)
      for (const assistant of assistants) {
        await onImport(assistant)
      }
      toast.success({
        titleKey: IMPORT_SUCCESS_KEY,
        resolveText: (key) => (key === IMPORT_SUCCESS_KEY ? labels.importSuccess(assistants.length) : '')
      })
      setRawJson('')
      onClose()
    } catch {
      // 失败档类型上强制带动作：这里给的就是「再导一次」，框里的 JSON 还在，不用重贴。
      toast.danger({
        titleKey: IMPORT_FAILED_KEY,
        resolveText: (key) => (key === IMPORT_FAILED_KEY ? labels.importFailed : ''),
        action: { labelKey: labels.importSubmit, onSelect: () => void importJson() }
      })
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
