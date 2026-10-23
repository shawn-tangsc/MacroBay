import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 「改动即存」的保存状态机（页面级一份）。
 *
 * 保存规则：
 *  - 没有整页「保存」按钮，每个控件自己决定保存边界（失焦 / 开关 / 下拉 / 增删）；
 *  - 保存中只锁**当前控件**（按 key 独立 pending），不锁整页、也不丢其它控件的保存；
 *  - 成功在标题旁显示 2 秒「已保存」后淡出；
 *  - 失败由调用方回滚自己的值，错误按 key 行内展示（不回退整页、不清空其它草稿）。
 *
 * 本 hook 只持有 UI 保存状态，不碰任何 IPC；任务本身由调用方注入。
 */
export const MODEL_SERVICE_SAVED_FLASH_MS = 2000

export type ModelServiceAutosave = {
  pending: ReadonlySet<string>
  isPending: (key: string) => boolean
  saved: boolean
  errorFor: (key: string) => string | null
  errorForPrefix: (prefix: string) => string | null
  run: (key: string, task: () => Promise<void>, rollback?: () => void) => Promise<boolean>
  reset: () => void
}

export function useModelServiceAutosave(failureMessage: string): ModelServiceAutosave {
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [saved, setSaved] = useState(false)
  const pendingRef = useRef(new Set<string>())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
  }, [])

  const run = useCallback(async (
    key: string,
    task: () => Promise<void>,
    rollback?: () => void
  ): Promise<boolean> => {
    // 同一个控件正在保存时忽略重复触发（失焦/回车可能连着来），不同控件互不阻塞。
    if (pendingRef.current.has(key)) return false
    pendingRef.current.add(key)
    setPendingKeys(new Set(pendingRef.current))
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      await task()
      setSaved(true)
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => {
        setSaved(false)
        flashTimer.current = null
      }, MODEL_SERVICE_SAVED_FLASH_MS)
      return true
    } catch {
      rollback?.()
      setErrors((current) => ({ ...current, [key]: failureMessage }))
      return false
    } finally {
      pendingRef.current.delete(key)
      setPendingKeys(new Set(pendingRef.current))
    }
  }, [failureMessage])

  const reset = useCallback(() => {
    pendingRef.current.clear()
    setPendingKeys(new Set())
    setErrors({})
  }, [])

  return {
    pending: pendingKeys,
    isPending: (key) => pendingKeys.has(key),
    saved,
    errorFor: (key) => errors[key] ?? null,
    errorForPrefix: (prefix) => {
      const key = Object.keys(errors).find((candidate) => candidate.startsWith(prefix))
      return key === undefined ? null : errors[key] ?? null
    },
    run,
    reset
  }
}
