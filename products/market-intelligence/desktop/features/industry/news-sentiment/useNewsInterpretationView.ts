import { useCallback, useEffect, useState } from 'react'

import { requestNewsInterpretation } from '../../../shared/ipc/newsInterpretationClient'
import { newsInterpretationResultCopy } from '../../../shared/i18n/newsInterpretationResultCopy'
import { useNewsInterpretationRead } from './useNewsInterpretationRead'

export type NewsInterpretationFailure = Readonly<{ itemId: string; sentenceKey: string; retry: boolean }>

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

  // 收敛：读接口已经有结果时，「提交中」必须结束——不许一直停在「正在生成」。
  useEffect(() => {
    if (submittingItemId === undefined || submittingItemId !== input.activeItemId) return
    if (activeRead.view?.state === 'available') setSubmittingItemId(undefined)
  }, [activeRead.view, input.activeItemId, submittingItemId])

  // 轮询：一次运行可能要一两分钟，界面不能只靠读者手点。每 3 秒重读一次，最多 40 次（2 分钟）。
  useEffect(() => {
    if (submittingItemId === undefined) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (tries > 40) { clearInterval(timer); return }
      activeRead.reload()
    }, 3000)
    return () => { clearInterval(timer) }
  }, [activeRead, submittingItemId])

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
