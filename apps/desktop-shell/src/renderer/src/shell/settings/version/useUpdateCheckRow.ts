import { useCallback, useEffect, useRef, useState } from 'react'

import { manualCooldownMs, type UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import type { UpdateCheckClient } from './updateCheckClient'

/**
 * 「版本」那一行的状态：投影、正在查、刚查过、打开失败。
 *
 * 四条规矩写在这里，而不是散在 JSX 里：
 * - 首帧还没读到投影时是 `null`（显示为「还没检查」），读完换成真实投影；
 * - 检查中只置 `checking`，**不新建等待区**：按钮自己转；
 * - 冷却的「刚查过」是显示层的计时，与主进程那道 1 分钟闸同一时长——这里不发请求，主进程也不发；
 * - 「打开失败」只改这一行下面那句话，**绝不碰投影**。所以它单独一个状态，不塞进 `state`。
 */
export type UpdateCheckRowState = {
  state: UpdateCheckProjection | null
  checking: boolean
  justChecked: boolean
  openFailed: boolean
  checkNow: () => Promise<void>
  openUpdateLink: () => Promise<void>
}

export function useUpdateCheckRow(client: UpdateCheckClient): UpdateCheckRowState {
  const [state, setState] = useState<UpdateCheckProjection | null>(null)
  const [checking, setChecking] = useState(false)
  const [justChecked, setJustChecked] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    void client
      .getState()
      .then((projection) => {
        if (!cancelled) setState(projection)
      })
      .catch(() => {
        // 读不到投影就保持在「还没检查」：不猜一个结论，也不弹窗。
      })
    return () => {
      cancelled = true
      if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current)
    }
  }, [client])

  const checkNow = useCallback(async () => {
    setChecking(true)
    setOpenFailed(false)
    try {
      setState(await client.checkNow())
      // 主进程那边 1 分钟内不会再发请求；这里只负责把按钮上的字换成「刚查过」。
      setJustChecked(true)
      if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current)
      cooldownTimer.current = setTimeout(() => setJustChecked(false), manualCooldownMs)
    } catch {
      // 开发态那条通道不存在，会 reject；界面本来就不显示那两个按钮。
    } finally {
      setChecking(false)
    }
  }, [client])

  const openUpdateLink = useCallback(async () => {
    try {
      const result = await client.openUpdateLink()
      setOpenFailed(!result.ok)
    } catch {
      setOpenFailed(true)
    }
  }, [client])

  return { state, checking, justChecked, openFailed, checkNow, openUpdateLink }
}
