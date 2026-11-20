import { useState } from 'react'

/**
 * 政策抽屉叠在关键指标抽屉之上（用户 2026-11-20）。
 *
 * 两件事拆不开：打开时**不关**下面那层（两层一起看），关闭后焦点回到**触发它的那颗按钮**
 * （键盘读者不从页面开头重走）。触发元素必须由点击方递上来——macOS 上点按钮不保证聚焦，
 * 靠 `document.activeElement` 猜会把焦点还错地方。
 */
export function usePolicyDrawerOverlay(): Readonly<{
  open: boolean
  /** 触发这颗抽屉的按钮；关闭时把焦点还给它。 */
  trigger: HTMLElement | null
  openFrom: (trigger: HTMLElement) => void
  close: () => void
}> {
  const [open, setOpen] = useState(false)
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  return {
    open,
    trigger,
    openFrom: (element) => { setTrigger(element); setOpen(true) },
    close: () => setOpen(false)
  }
}
