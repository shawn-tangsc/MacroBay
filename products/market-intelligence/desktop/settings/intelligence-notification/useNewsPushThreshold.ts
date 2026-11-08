import { useCallback, useEffect, useState } from 'react'

import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'
import {
  newsPushThresholdClient,
  type NewsPushThresholdClient
} from '../../shared/ipc/newsPushThresholdClient'

/**
 * 「强度门槛」的读与写（舆情提醒那一项里的一行）。
 *
 * 三条和旁边那个开关同一套：**值只从服务读**、**写完读回的值说了算**、**默认「中」**
 * （＝这条功能上线以来的行为，读不到也不会悄悄放宽成「弱」）。
 */
export type NewsPushThresholdRowState = Readonly<{
  status: 'loading' | 'ready' | 'error'
  value: NewsSentimentTierThreshold
  saving: boolean
  saveFailed: boolean
  reload: () => void
  setThreshold: (next: NewsSentimentTierThreshold) => void
}>

export function useNewsPushThreshold(
  client: NewsPushThresholdClient = newsPushThresholdClient
): NewsPushThresholdRowState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [value, setValue] = useState<NewsSentimentTierThreshold>('medium')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void client.state().then(
      (state) => {
        if (cancelled) return
        setValue(state.pushThreshold)
        setStatus('ready')
      },
      () => { if (!cancelled) setStatus('error') }
    )
    return () => { cancelled = true }
  }, [client, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const setThreshold = useCallback((next: NewsSentimentTierThreshold) => {
    setSaving(true)
    setSaveFailed(false)
    void client.save(next).then(
      (state) => {
        // 写完读回的值说了算：服务端没改成，界面就跟着它回到原值。
        setValue(state.pushThreshold)
        setSaving(false)
        setStatus('ready')
      },
      () => { setSaving(false); setSaveFailed(true) }
    )
  }, [client])

  return { status, value, saving, saveFailed, reload, setThreshold }
}
