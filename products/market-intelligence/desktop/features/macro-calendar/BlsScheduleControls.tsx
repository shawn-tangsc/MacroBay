import { RefreshCw } from 'lucide-react'
import { Alert, Button } from 'antd'

export type BlsScheduleState = 'updated' | 'unchanged' | 'unavailable'
export type BlsValueState = 'updated' | 'current' | 'not-required' | 'unavailable'
export type BlsScheduleFeedback = {
  schedule: BlsScheduleState
  cpi: BlsValueState
  employment: BlsValueState
}

export type BlsScheduleText = {
  action: string
  pending: string
  feedback: {
    schedule: Readonly<Record<BlsScheduleState, string>>
    cpi: Readonly<Record<BlsValueState, string>>
    employment: Readonly<Record<BlsValueState, string>>
  }
}

/**
 * Official BLS schedule sync. Shared by the dashboard drawer and the macro
 * calendar settings page so the confirmation, pending, and result wording stay
 * identical in both surfaces.
 */
export function BlsScheduleControls({ feedback, pending, selected, text, onSync }: {
  feedback?: { selection: string; result: BlsScheduleFeedback }
  pending: boolean
  selected: string
  text: BlsScheduleText
  onSync: () => Promise<void>
}): React.ReactElement {
  return <div className="mi-dashboard-source-drawer__bls-schedule-controls">
    <Button disabled={pending} icon={<RefreshCw aria-hidden="true" size={14} />} loading={pending} onClick={() => void onSync()} type="primary">
      {pending ? text.pending : text.action}
    </Button>
    {feedback?.selection === selected ? <Alert message={`${text.feedback.schedule[feedback.result.schedule]} · ${text.feedback.cpi[feedback.result.cpi]} · ${text.feedback.employment[feedback.result.employment]}`} showIcon type={feedback.result.schedule === 'unavailable' ? 'error' : 'success'} /> : null}
  </div>
}
