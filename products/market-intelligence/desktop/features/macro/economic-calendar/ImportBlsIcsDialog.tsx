import { Button, Modal } from 'antd'
import { Check, X } from 'lucide-react'
import type { ReactElement } from 'react'

import type { EconomicCalendarText } from './economicCalendarText'
import type { BlsIcsImportDialogState } from './useBlsIcsImport'

export const importBlsIcsDialogPolicy = {
  keyboardClosable: true,
  maximumWidth: 520,
  preserveContentAfterClose: false,
  renderInCalendar: true
} as const

type Props = {
  dialogState: BlsIcsImportDialogState
  onClose: () => void
  onConfirm: () => void
  text: EconomicCalendarText
}

export function ImportBlsIcsDialog({ dialogState, onClose, onConfirm, text }: Props): ReactElement | null {
  if (dialogState.state === 'closed') return null
  const preview = dialogState.state === 'ready' || dialogState.state === 'importing'
    ? dialogState.preview
    : dialogState.state === 'result'
      ? dialogState.result
      : undefined
  const filename = 'filename' in dialogState ? dialogState.filename : undefined
  const importing = dialogState.state === 'importing'
  const ready = dialogState.state === 'ready'

  return (
    <Modal
      className="mi-bls-ics-dialog"
      destroyOnHidden={!importBlsIcsDialogPolicy.preserveContentAfterClose}
      footer={ready ? (
        <div className="mi-bls-ics-dialog__footer">
          <Button onClick={onClose}>{text.manualImport.actions.cancel}</Button>
          <Button icon={<Check aria-hidden="true" size={14} />} loading={importing} onClick={onConfirm} type="primary">
            {text.manualImport.actions.confirm}
          </Button>
        </div>
      ) : (
        <div className="mi-bls-ics-dialog__footer">
          <Button icon={<X aria-hidden="true" size={14} />} onClick={onClose}>{text.manualImport.actions.close}</Button>
        </div>
      )}
      getContainer={importBlsIcsDialogPolicy.renderInCalendar ? false : undefined}
      keyboard={importBlsIcsDialogPolicy.keyboardClosable}
      onCancel={onClose}
      open
      title={text.manualImport.title}
      width={importBlsIcsDialogPolicy.maximumWidth}
    >
      <section className="mi-bls-ics-dialog__content" aria-live="polite">
        {filename ? <p className="mi-bls-ics-dialog__filename"><span>{text.manualImport.filename}</span><strong>{filename}</strong></p> : null}
        {dialogState.state === 'failed' ? <p className="mi-bls-ics-dialog__status" data-state="failed">{text.manualImport.failures[dialogState.failureCode]}</p> : null}
        {dialogState.state === 'importing' ? <p className="mi-bls-ics-dialog__status">{text.manualImport.status.importing}</p> : null}
        {dialogState.state === 'result' ? <p className="mi-bls-ics-dialog__status" data-state="success">{text.manualImport.results[dialogState.result.state]}</p> : null}
        {preview ? <Counts text={text} counts={preview} /> : null}
      </section>
    </Modal>
  )
}

function Counts({ text, counts }: {
  text: EconomicCalendarText
  counts: {
    totalEvents: number
    supportedReleaseGroups: number
    generatedEvents: number
    unsupportedEvents: number
    insertedCount?: number
    rescheduledCount?: number
    unchangedCount: number
  }
}): ReactElement {
  const rows = [
    ['totalEvents', counts.totalEvents],
    ['supportedReleaseGroups', counts.supportedReleaseGroups],
    ['generatedEvents', counts.generatedEvents],
    ['unsupportedEvents', counts.unsupportedEvents],
    ['insertedCount', counts.insertedCount],
    ['rescheduledCount', counts.rescheduledCount],
    ['unchangedCount', counts.unchangedCount]
  ] as const
  return (
    <dl className="mi-bls-ics-dialog__counts">
      {rows.map(([key, count]) => count === undefined ? null : <div key={key}><dt>{text.manualImport.counts[key]}</dt><dd>{count}</dd></div>)}
    </dl>
  )
}
