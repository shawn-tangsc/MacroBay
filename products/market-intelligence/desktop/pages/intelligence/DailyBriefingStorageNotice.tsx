import { useEffect, useState } from 'react'
import { Button } from 'antd'

import { dailyBriefingClient, type DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

import './dailyBriefingStorageNotice.css'

/**
 * The storage upgrade's state, on the brief page.
 *
 * This is a status, not an explanation: the reader's history is still there, but the upgrade did
 * not finish, so the sentence stays visible instead of moving behind a help icon. The retry is the
 * same upgrade the application ran at startup, and only an answer that says `ready` hides the
 * notice — a read that failed is not evidence that the upgrade ran.
 */
export type DailyBriefingStorageNoticeText = Readonly<{
  incomplete: string
  retry: string
  retrying: string
}>

type NoticeState = 'unknown' | 'hidden' | 'incomplete' | 'retrying'

export function DailyBriefingStorageNotice({ text, client = dailyBriefingClient }: Readonly<{
  text: DailyBriefingStorageNoticeText
  client?: Pick<DailyBriefingClient, 'getStorageState' | 'retryUpgrade'>
}>): React.ReactElement | null {
  const [state, setState] = useState<NoticeState>('unknown')

  useEffect(() => {
    let active = true
    void client.getStorageState().then((result) => {
      if (!active) return
      setState(result.state === 'incomplete' ? 'incomplete' : 'hidden')
    })
    return () => { active = false }
  }, [client])

  if (state !== 'incomplete' && state !== 'retrying') return null
  const retrying = state === 'retrying'

  return (
    <div className="mi-daily-brief-banner mi-daily-brief-banner--pending mi-daily-briefing-storage-notice" role="status" data-storage-upgrade="incomplete">
      <span className="mi-daily-brief-banner__copy">{text.incomplete}</span>
      <Button
        size="small"
        disabled={retrying}
        onClick={() => {
          setState('retrying')
          void client.retryUpgrade().then((result) => {
            setState(result.state === 'ready' ? 'hidden' : 'incomplete')
          })
        }}
      >
        {retrying ? text.retrying : text.retry}
      </Button>
    </div>
  )
}
