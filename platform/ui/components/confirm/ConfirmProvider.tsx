import { Modal } from 'antd'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'

import { confirmOptions, type ModalInstance } from './confirmOptions'
import type { ConfirmProps } from './Confirm'

/**
 * 确认框的宿主（2026-11-02 用户报的「深色界面弹浅色确认框」）。
 *
 * 根因不是样式写错，是**渲染位置错了**：静态 `Modal.confirm` 站在 React 树外，只吃 antd 默认主题。
 * 所以确认框改由 `Modal.useModal()` 的实例渲染，`contextHolder` 放进树里——这样它吃到的是当前
 * 这棵树上的 `ConfigProvider`（主题、语言、按钮配置），深浅色与主界面一致。
 *
 * 三条写进结构、不靠评审：
 * - **宿主必须真的挂上**：`useConfirm()` 找不到 Provider 直接抛错，不静默退回静态方法。
 *   静默退回正是这个 bug 能活到今天的原因——看起来能用，颜色错了没人报错。
 * - **一个进程里可能有两个渲染根**（主窗与分离窗各自独立），所以每个根都要挂一次；
 *   分离窗那条不是冗余，它不吃主窗的 Provider，这正是这条债最早发生的地方。
 * - **遗留入口也要吃同一个实例**：`confirmAction()` 仍是三处调用点正在用的名字，它从本模块登记的
 *   实例里取，取不到同样抛错——所以「组件换了、那三处没换」的中间态不会掉回浅色框。
 */

const ConfirmContext = createContext<((props: ConfirmProps) => void) | null>(null)

/**
 * 进程内最近挂载的实例。只服务于遗留的 `confirmAction()`；
 * 新代码一律走 `useConfirm()`（它拿的是本树的那一个，不依赖「最近」这种全局状态）。
 */
let mountedInstance: ModalInstance | null = null

/** 仅供测试：断言卸载后不会留下一个已卸载的实例。 */
export function currentConfirmInstanceForTest(): ModalInstance | null {
  return mountedInstance
}

export function ConfirmProvider({ children }: { children: ReactNode }): ReactElement {
  const [modal, contextHolder] = Modal.useModal()

  // 登记给遗留入口；卸载时只有「还是自己」才清空，避免把后挂上的那个擦掉。
  useEffect(() => {
    mountedInstance = modal
    return () => {
      if (mountedInstance === modal) mountedInstance = null
    }
  }, [modal])

  const confirm = useCallback(
    (props: ConfirmProps) => {
      // 触发它的那颗按钮：关闭后焦点要还回去（丢失焦点 = 键盘读者丢了自己刚才在哪一行）。
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      modal.confirm(confirmOptions(props, trigger))
    },
    [modal]
  )
  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {contextHolder}
    </ConfirmContext.Provider>
  )
}

/**
 * 取本棵树的 `confirm`。**没有 Provider 就抛错**：回落静态方法是这个 bug 的成因，不是兜底。
 */
export function useConfirm(): (props: ConfirmProps) => void {
  const confirm = useContext(ConfirmContext)
  if (confirm === null) {
    throw new Error(
      'useConfirm() must be called inside <ConfirmProvider>: without it the dialog renders outside the React tree and ignores the current theme'
    )
  }
  return confirm
}
