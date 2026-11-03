import { useCallback, useState } from 'react'

import type { PlatformText } from '../i18n/platformText'
import type { PlatformLiveText } from './liveText'
import { proxyRejectionNotice } from './proxySettingsNotice'

/**
 * 设置页右上角那条提示：**存事实，不存句子**。
 *
 * `show` 收的是「怎么生成这句话」的函数，句子在渲染时按当前语言解析（`resolveLiveText`）。
 * 之前直接把 `t.status.saved` 塞进状态，语言就被冻结在保存那一刻——切到英文后右上角还写着
 * 「已保存」，切回中文又变成 "Saved"。
 */
export function useLiveNotice(): Readonly<{
  notice: PlatformLiveText | null
  clear: () => void
  show: (live: PlatformLiveText) => void
  showSaved: () => void
  showSaveFailed: (error: unknown) => void
}> {
  const [notice, setNotice] = useState<PlatformLiveText | null>(null)

  const clear = useCallback(() => setNotice(null), [])
  const show = useCallback((live: PlatformLiveText) => setNotice(() => live), [])
  const showSaved = useCallback(() => setNotice(() => (current: PlatformText) => current.status.saved), [])
  const showSaveFailed = useCallback(
    (error: unknown) =>
      setNotice(() => (current: PlatformText) => proxyRejectionNotice(error, current.preferences) ?? current.status.failed),
    []
  )

  return { notice, clear, show, showSaved, showSaveFailed }
}
