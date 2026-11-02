import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ConfirmProps } from './Confirm'
import { ConfirmProvider } from './ConfirmProvider'

/**
 * 产品组件测试的**共用入口**：把被测 UI 挂在 `ConfirmProvider` 下。
 *
 * 为什么需要它（2026-11-02）：确认框改成树内渲染后，凡是用到它的组件都必须在 `ConfirmProvider` 里
 * 渲染，否则 `useConfirm()` 按契约抛错。当天全量验证里有 **16 例**因此失败，散在四个文件里，
 * 每个文件各写一遍 `createRoot(... <ConfirmProvider>{ui}</ConfirmProvider>)` ——那是在九处复制同一个前提。
 * 少写一次就是一次「测试抛错、看着像产品坏了」，所以入口只留一个。
 *
 * 用法（测试文件里）：
 *
 * ```tsx
 * const view = renderWithConfirm(<MyPage />)
 * await view.settle()
 * view.clickConfirm('删除')   // 点弹窗里那个按钮，而不是调内部函数
 * view.unmount()
 * ```
 *
 * 它刻意**不 mock antd**：确认框的价值有一半在「真的渲染在树里、真的跟主题走」，
 * mock 掉就只能证明「某个函数被调用了」。
 */
export type ConfirmHarness = {
  host: HTMLDivElement
  root: Root
  /** 等一帧 React 提交 + antd 的弹层挂载。 */
  settle: () => Promise<void>
  /** 等弹窗真的出现（轮询到条件成立，不用固定 sleep）。 */
  waitForDialog: () => Promise<HTMLElement | null>
  /** 点弹窗里的按钮（按文案匹配，去掉空白）。找不到就抛，不静默放过。 */
  clickDialogButton: (label: string) => Promise<void>
  /** 弹窗当前的文案，用来断言「标题/后果」有没有真的上屏。 */
  dialogText: () => string
  unmount: () => Promise<void>
}

export function renderWithConfirm(ui: React.ReactNode): ConfirmHarness {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(<ConfirmProvider>{ui}</ConfirmProvider>)
  })

  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const waitForDialog = async (): Promise<HTMLElement | null> => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const dialog = document.querySelector<HTMLElement>('.ant-modal')
      if (dialog !== null) return dialog
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
    return null
  }

  const clickDialogButton = async (label: string): Promise<void> => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.ant-modal button')]
    const target = buttons.find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === label)
    if (target === undefined) {
      throw new Error(`confirm dialog has no button labelled "${label}"`)
    }
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
  }

  const dialogText = (): string => document.querySelector('.ant-modal')?.textContent ?? ''

  return {
    host,
    root,
    settle,
    waitForDialog,
    clickDialogButton,
    dialogText,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    }
  }
}

/** 一处最常用的断言配套：把 `confirm()` 的四个字段写成一份，少写一次就少一次笔误。 */
export function testConfirmProps(overrides: Partial<ConfirmProps> = {}): ConfirmProps {
  return {
    title: 'Delete this?',
    description: 'It cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    tone: 'danger',
    onConfirm: () => undefined,
    ...overrides
  }
}
