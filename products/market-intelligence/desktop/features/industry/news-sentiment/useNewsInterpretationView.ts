import { useCallback, useEffect, useRef, useState } from 'react'

import { requestNewsInterpretation } from '../../../shared/ipc/newsInterpretationClient'
import { newsInterpretationResultCopy } from '../../../shared/i18n/newsInterpretationResultCopy'
import { useNewsInterpretationRead } from './useNewsInterpretationRead'

export type NewsInterpretationFailure = Readonly<{ itemId: string; sentenceKey: string; retry: boolean }>

/** 轮询间隔：运行没结束前，界面每 3 秒重读一次。 */
export const NEWS_INTERPRETATION_POLL_MS = 3_000
/**
 * 等多久就认定「等不到了」。一次解读正常 1.5–2 分钟，给到 3 分钟。
 * 到点无论服务端说什么，界面都必须落失败态并给重试——「正在生成」绝不允许永驻：
 * 服务端挂住、应用中途被关、或者一次运行卡在 inflight，读者都得拿到一个能行动的结论。
 */
export const NEWS_INTERPRETATION_WAIT_MS = 180_000

/**
 * 「AI 解读」的读取 + 提交状态机（R37）：抽屉只保留渲染与挂载，这一块单独成模块。
 *
 * 三条规矩：
 * - **提交中必须收敛**：排上后立刻重读一次；读接口一到 `available` 就结束提交态，
 *   读者还能用「读取结果」自己催一次（只催读，不排新分析）；
 * - **重试分两种**：读失败的重试只重读，写失败的重试才真的重发；
 * - **三种「没开始」三种说法**：`unreachable`（客户端自己的事，可重试）/ `no-judgment` / `not-eligible`
 *   走各自的句子，不共用一句兜底。
 */
export function useNewsInterpretationView(input: Readonly<{
  activeItemId: string | undefined
  drawerOpen: boolean
  contextMenuItemId: string | undefined
  contextMenuOpen: boolean
}>): Readonly<{
  activeView: ReturnType<typeof useNewsInterpretationRead>['view']
  menuView: ReturnType<typeof useNewsInterpretationRead>['view']
  menuLoading: boolean
  submittingItemId: string | undefined
  failureFor: (itemId: string | undefined) => NewsInterpretationFailure | undefined
  reloadActive: () => void
  submit: (itemId: string) => void
}> {
  const activeRead = useNewsInterpretationRead(input.activeItemId, input.drawerOpen)
  const menuRead = useNewsInterpretationRead(input.contextMenuItemId, input.contextMenuOpen)
  const [submittingItemId, setSubmittingItemId] = useState<string>()
  const [failure, setFailure] = useState<NewsInterpretationFailure>()

  // 收敛：读接口已经有结果时，「提交中」结束、失败态也清掉；读接口明确失败（`none` + `lastRun`）时，
  // 提交态同样必须结束——不结束就会盖住失败态，让读者永远等下去。
  useEffect(() => {
    const view = activeRead.view
    if (view?.state === 'available') setFailure(undefined)
    if (submittingItemId === undefined || submittingItemId !== input.activeItemId) return
    if (view?.state === 'available' || (view?.state === 'none' && view.lastRun !== undefined)) {
      setSubmittingItemId(undefined)
    }
  }, [activeRead.view, input.activeItemId, submittingItemId])

  // 轮询 + 总时限（本地发起的那一次）：每 3 秒重读一次，到点仍没终态就落失败。
  // reload 走 ref：否则每次重读都会重建 effect、把计时器清零——那正是「转圈停不下来」的成因之一。
  const reloadRef = useRef(activeRead.reload)
  reloadRef.current = activeRead.reload
  useEffect(() => {
    if (submittingItemId === undefined) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= NEWS_INTERPRETATION_WAIT_MS) {
        clearInterval(timer)
        setSubmittingItemId(undefined)
        setFailure({ itemId: submittingItemId, sentenceKey: 'mi.aiInterpretation.waitExceeded', retry: true })
        return
      }
      reloadRef.current()
    }, NEWS_INTERPRETATION_POLL_MS)
    return () => { clearInterval(timer) }
  }, [submittingItemId])

  // 服务端已经在跑、但不是这一屏发起的那一次（比如上次点完关掉应用、或运行挂死）：
  // 一样要有时限。只读接口一直回 `in-flight`，界面就不能一直转圈——到点落失败并可重试。
  const inFlightSince = useRef<Readonly<{ itemId: string; at: number }> | undefined>(undefined)
  useEffect(() => {
    const itemId = input.activeItemId
    const view = activeRead.view
    if (itemId === undefined || submittingItemId !== undefined || view?.state !== 'in-flight') {
      inFlightSince.current = undefined
      return
    }
    const now = Date.now()
    if (inFlightSince.current?.itemId !== itemId) inFlightSince.current = { itemId, at: now }
    const remaining = NEWS_INTERPRETATION_WAIT_MS - (now - inFlightSince.current.at)
    if (remaining <= 0) {
      setFailure({ itemId, sentenceKey: 'mi.aiInterpretation.waitExceeded', retry: true })
      return
    }
    const timer = setTimeout(() => {
      setFailure({ itemId, sentenceKey: 'mi.aiInterpretation.waitExceeded', retry: true })
    }, remaining)
    return () => { clearTimeout(timer) }
  }, [activeRead.view, input.activeItemId, submittingItemId])

  const submit = useCallback((itemId: string): void => {
    setSubmittingItemId(itemId)
    setFailure(undefined)
    void requestNewsInterpretation(itemId).then((result) => {
      if (result.state === 'queued' || result.state === 'in-flight') {
        activeRead.reload()
        return
      }
      setSubmittingItemId(undefined)
      if (result.state === 'already-available') {
        activeRead.reload()
        return
      }
      if (result.state === 'unreachable') {
        setFailure({ itemId, sentenceKey: 'mi.aiInterpretation.unreachable', retry: true })
        return
      }
      const copy = result.state === 'no-judgment' || result.state === 'not-eligible'
        ? newsInterpretationResultCopy({ state: result.state })
        : result.state === 'insufficient-facts'
          ? newsInterpretationResultCopy({ insufficientReason: result.details.reason })
          : result.state === 'not-ready' || result.state === 'failed'
            ? newsInterpretationResultCopy({ failureCode: result.failureCode })
            : newsInterpretationResultCopy({})
      setFailure({ itemId, sentenceKey: copy.sentenceKey, retry: copy.action === 'retry' })
    })
  }, [activeRead])

  return {
    activeView: activeRead.view,
    menuView: menuRead.view,
    menuLoading: menuRead.loading,
    submittingItemId,
    failureFor: (itemId) => (itemId !== undefined && failure?.itemId === itemId ? failure : undefined),
    reloadActive: activeRead.reload,
    submit
  }
}
