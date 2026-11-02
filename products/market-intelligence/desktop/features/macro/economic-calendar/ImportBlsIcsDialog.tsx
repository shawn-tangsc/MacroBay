import { Button } from 'antd'
import { Check, X } from 'lucide-react'
import type { ReactElement } from 'react'

import { Modal } from '@platform/ui/components/modal'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { EconomicCalendarText } from './economicCalendarText'
import type { BlsIcsImportDialogState } from './useBlsIcsImport'

/**
 * 宽度、标题与关闭键归平台 `Modal`；页脚仍由调用点给——它随状态在两套按钮之间换
 * （导入中 / 已就绪 / 失败 / 结果），不是弹窗骨架的事。
 *
 * 平台 `Modal` 不接容器，弹窗挂在 body 上，所以 `.mi-bls-ics-dialog` 必须自己带
 * `--mi-economic-*` 那一套 token：变量只声明在 `.mi-economic-calendar` 上时，body 上
 * 一个都取不到，声明在计算期整体失效且不报错（见
 * `docs-private/10-development/pitfalls/2026-10-15-a-reused-surface-must-carry-its-token-scope.md`）。
 */
export const importBlsIcsDialogPolicy = {
  titleKey: 'pages.intelligence.portal.calendar.manualImport.title',
  width: 'standard',
  preserveContentAfterClose: false
} as const

type Props = {
  dialogState: BlsIcsImportDialogState
  onClose: () => void
  onConfirm: () => void
  text: EconomicCalendarText
}

export function ImportBlsIcsDialog({ dialogState, onClose, onConfirm, text }: Props): ReactElement | null {
  const resolveText = useProductTextKey()
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
      onClose={onClose}
      open
      resolveText={resolveText}
      titleKey={importBlsIcsDialogPolicy.titleKey}
      width={importBlsIcsDialogPolicy.width}
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
