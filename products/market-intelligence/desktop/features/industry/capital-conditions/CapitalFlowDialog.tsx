import { Modal } from '@platform/ui/components/modal'

import { CapitalFlowChart } from './CapitalFlowChart'
import { CapitalFlowDailyTable } from './CapitalFlowDailyTable'
import type { FlowChartRow } from './capitalFlowRows'

type DialogText = Parameters<typeof CapitalFlowChart>[0]['text'] & Parameters<typeof CapitalFlowDailyTable>[0]['text']

/**
 * The chart and its daily numbers together in one dialog, so a reader can see the three labelled
 * bars and the table they come from in the same frame — which is also what makes it screenshot
 * one screen.
 *
 * The dialog itself is the platform `Modal`: focus trapping, Escape, the backdrop and returning
 * focus to the trigger are its job. Nothing here positions, closes or focuses anything.
 */
export function CapitalFlowDialog({ open, onClose, rows, text, resolveText }: Readonly<{
  open: boolean
  onClose: () => void
  rows: readonly FlowChartRow[]
  text: DialogText
  resolveText: (key: string) => string
}>): React.ReactElement {
  const titleKey = 'pages.intelligence.portal.dashboard.capitalConditions.dailyDialogTitle'
  return <Modal open={open} onClose={onClose} width="expanded" titleKey={titleKey} resolveText={resolveText}>
    <div className="mi-capital-conditions__dialog">
      <CapitalFlowChart rows={rows} text={text} />
      <CapitalFlowDailyTable rows={rows} text={text} />
    </div>
  </Modal>
}
