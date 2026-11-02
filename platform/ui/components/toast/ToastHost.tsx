import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { ToastItem, type ToastAction, type ToastTone } from './ToastItem'
import { TOAST_REGION_KEY, useToastText } from './toastText'

import './toast.css'

/**
 * 提示宿主（契约 §12）。每个渲染根挂一次（主窗 + 每个分离窗），队列在宿主里。
 *
 * 骨架期先落三条写死的东西，队列与去重下一笔：
 * - **宿主 `pointer-events: none`**：那一块是隐形矩形，设成 auto 会把页面底部按钮整片罩住；
 * - **层级高于弹窗**（`over-drawer` 是 1500，这里 1600），固定在宿主里，不给 `layer` prop；
 * - **关闭键归组件**，读屏名走 `toastText` 常量。
 */

export type ToastInput = {
  titleKey: string
  descKey?: string
  action?: ToastAction
}

export type ToastApi = {
  success: (input: ToastInput) => void
  info: (input: ToastInput) => void
  /** 危险档**类型强制带动作**：不给编译不过，别让读者只看到一句"失败了"。 */
  danger: (input: ToastInput & { action: ToastAction }) => void
}

type ToastEntry = ToastInput & { id: number; tone: ToastTone }

/** 成功/信息 3s、失败 6s：失败要留够读和做动作的时间。 */
const DURATION_MS: Record<ToastTone, number> = { success: 3000, info: 3000, danger: 6000 }
/** 最多两条：第三条挤掉最旧的，不排队。 */
const MAX_VISIBLE = 2

const ToastContext = createContext<{ push: (tone: ToastTone, input: ToastInput) => void } | null>(null)

export type ToastHostProps = {
  resolveText: (key: string) => string
  children: ReactNode
}

export function ToastHost({ resolveText, children }: ToastHostProps): ReactElement {
  const [entries, setEntries] = useState<ToastEntry[]>([])
  const regionLabel = useToastText()(TOAST_REGION_KEY)

  const push = useCallback((tone: ToastTone, input: ToastInput) => {
    setEntries((current) => {
      const next = { ...input, id: Date.now() + Math.random(), tone }
      // 最多两条：第三条挤掉最旧的，不排队。
      return [...current, next].slice(-MAX_VISIBLE)
    })
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-label={regionLabel} className="toast-region" role="region">
        {entries.map((entry) => (
          <TimedToast
            durationMs={DURATION_MS[entry.tone]}
            entry={entry}
            key={entry.id}
            onDismiss={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}
            onExpire={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}
            resolveText={resolveText}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * 一条带计时器的提示。
 *
 * 悬停或聚焦**暂停**、离开后恢复的是**剩余时间**，不是重新计时：写成 `clearTimeout` 再设一个
 * 完整时长，表面上暂停了，实际读者移开鼠标又能多看三秒——测试也看不出来，除非用假计时器在
 * 快到期时悬停、再多等一会儿断言它还在。
 */
function TimedToast({
  entry,
  durationMs,
  onDismiss,
  onExpire,
  resolveText
}: {
  entry: ToastEntry
  durationMs: number
  onDismiss: () => void
  onExpire: () => void
  resolveText: (key: string) => string
}): ReactElement {
  const [paused, setPaused] = useState(false)
  const remainingRef = useRef(durationMs)

  useEffect(() => {
    if (paused) return
    const startedAt = Date.now()
    const timer = setTimeout(onExpire, remainingRef.current)
    return () => {
      clearTimeout(timer)
      // 记下这次实际走了多久，恢复时只补剩下的那段。
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt))
    }
  }, [paused, onExpire])

  return (
    <div
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}>
      <ToastItem
        action={entry.action}
        descKey={entry.descKey}
        onDismiss={onDismiss}
        resolveText={resolveText}
        titleKey={entry.titleKey}
        tone={entry.tone}
      />
    </div>
  )
}

/** 写进契约的那条 fail-closed：没挂宿主就抛错，不许静默退化。 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (context === null) throw new Error('useToast must be used inside <ToastHost>')
  return {
    success: (input) => context.push('success', input),
    info: (input) => context.push('info', input),
    danger: (input) => context.push('danger', input)
  }
}
