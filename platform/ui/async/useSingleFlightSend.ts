import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 「发送一次」的单飞 + 冷却守卫（用户 2026-11-09 报：连点 4 次收到 4 条自检）。
 *
 * 三条行为写在这里、组件不各写一遍：
 * 1. **同一时刻只允许一个在飞**：靠 `useRef` 而不是 state——`setState` 是异步的，两次点击落在
 *    同一帧时 state 还是旧值，连点就会真的发多次。ref 在第一次点击的同步路径里就立起来。
 * 2. **成功后冷却**：冷却期内再点不发，返回 `'cooldown'`，由调用方就地提示。
 * 3. **失败不进入冷却**：失败本来就要允许重试，把失败也锁住等于让读者等十秒才能修一次错。
 *
 * 冷却到期靠定时器每秒重算一次（时钟可注入，用例拨表即可，不靠 sleep）。
 */
export type SingleFlightSendOutcome = 'sent' | 'failed' | 'busy' | 'cooldown'

export type SingleFlightSend = Readonly<{
  /** 有一次请求还在飞。 */
  sending: boolean
  /** 冷却剩余秒数（向上取整）；0 表示可发。 */
  cooldownSecondsLeft: number
  /** 现在能不能发（在飞或冷却中都为 false）。 */
  canSend: boolean
  run: () => Promise<SingleFlightSendOutcome>
}>

export function useSingleFlightSend(options: Readonly<{
  cooldownMs: number
  /** 真的去发：`true` = 成功（进入冷却），`false` = 失败（不冷却）。 */
  send: () => Promise<boolean>
  /** 时钟，注入以便用例拨表。 */
  now?: () => number
}>): SingleFlightSend {
  const now = options.now ?? Date.now
  const inFlight = useRef(false)
  const [sending, setSending] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (cooldownUntil === null) return
    const timer = setInterval(() => {
      if (now() >= cooldownUntil) setCooldownUntil(null)
      else forceTick((tick) => tick + 1)
    }, 1_000)
    return () => clearInterval(timer)
  }, [cooldownUntil, now])

  const remainingMs = cooldownUntil === null ? 0 : Math.max(0, cooldownUntil - now())
  const cooldownSecondsLeft = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1_000)

  const run = useCallback(async (): Promise<SingleFlightSendOutcome> => {
    if (inFlight.current) return 'busy'
    if (cooldownUntil !== null && now() < cooldownUntil) return 'cooldown'
    inFlight.current = true
    setSending(true)
    try {
      const ok = await options.send()
      if (ok) setCooldownUntil(now() + options.cooldownMs)
      return ok ? 'sent' : 'failed'
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }, [cooldownUntil, now, options])

  return {
    sending,
    cooldownSecondsLeft,
    canSend: !sending && cooldownSecondsLeft === 0,
    run
  }
}
