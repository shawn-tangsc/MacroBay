// @vitest-environment happy-dom

import { Component, act, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { confirmAction, type ConfirmProps } from './Confirm'
import { ConfirmProvider, currentConfirmInstanceForTest, useConfirm } from './ConfirmProvider'

/**
 * 宿主与钩子的真渲染用例（不 mock antd）。
 *
 * 要证明三件事，正是这个 bug 的三个面：
 * 1. **没有宿主就炸**：`useConfirm()` 不许静默退回静态方法——静默退回就是它活到今天的原因；
 * 2. **弹窗由本树的实例渲染**（`Modal.useModal()` 的 `contextHolder`），因此吃得到当前
 *    `ConfigProvider` 的主题；静态入口站在树外，只吃默认主题。主题一致的真机证据是交付图里
 *    `data-theme=dark` 与弹窗同屏（DOM 位置不是判据，antd 仍把节点挂在 body 的容器里）；
 * 3. **遗留入口吃同一个实例**：三处调用点还没迁，它们必须同样渲染在树里，否则「组件修好、
 *    调用点没换」的中间态仍然弹浅色框。
 */

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  document.body.replaceChildren()
})

const danger: ConfirmProps = {
  title: '删除这段会话？',
  description: '删除后无法恢复。',
  confirmLabel: '删除',
  cancelLabel: '取消',
  tone: 'danger',
  onConfirm: () => undefined
}

async function waitFor<T>(probe: () => T | null, attempt = 0): Promise<T | null> {
  const found = probe()
  if (found !== null) return found
  if (attempt > 80) return null
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return waitFor(probe, attempt + 1)
}

/** 打开确认框的探针：在 effect 里调，和真实调用点（点击处理器）同一个形状。 */
function OpenConfirm(): ReactElement {
  const confirm = useConfirm()
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    confirm(danger)
  }, [confirm])
  return <span />
}

/** 没有 Provider 的树：挂在树里调钩子，才和真实调用点同一个形状。 */
function NoProvider(): ReactElement {
  const confirm = useConfirm()
  return <button onClick={() => confirm(danger)} type="button">probe</button>
}

/** 错误边界：React 19 里渲染期异常落到这里，用它把「真的抛了」变成可断言的事实。 */
class CaptureError extends Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: Error): void {
    this.props.onError(error)
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

async function mount(tree: ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(tree)
  })
  return host
}

function buttonByLabel(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.textContent ?? '').replace(/\s+/gu, '') === label
  )
}

describe('ConfirmProvider', () => {
  it('throws when a tree has no provider, instead of quietly falling back to the static modal', async () => {
    // React 19 把渲染期异常交给错误边界，所以用边界接住它再断言——这仍然是「真的抛了」，
    // 而不是「有个函数返回了错误」。没有边界时，它会一路冒到主进程的控制台，那才是真的崩。
    const captured: Error[] = []
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <CaptureError onError={(error) => captured.push(error)}>
          <NoProvider />
        </CaptureError>
      )
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]?.message).toMatch(/ConfirmProvider/)
  })

  it('renders the dialog from this tree and shows the caller copy verbatim', async () => {
    await mount(
      <ConfirmProvider>
        <OpenConfirm />
      </ConfirmProvider>
    )
    const modal = await waitFor(() => document.querySelector<HTMLElement>('.ant-modal'))
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('删除这段会话？')
    expect(modal?.textContent).toContain('删除后无法恢复。')
  })

  it('puts the initial focus on cancel for a destructive action', async () => {
    await mount(
      <ConfirmProvider>
        <OpenConfirm />
      </ConfirmProvider>
    )
    const cancel = await waitFor(() => buttonByLabel('取消') ?? null)
    expect(cancel).not.toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    // 按住回车连击时，焦点落在破坏性按钮上就是连续执行。
    expect(document.activeElement).toBe(cancel)
    expect(buttonByLabel('删除')?.className).toContain('ant-btn-dangerous')
  })

  it('keeps the legacy entry working through the same instance, and fails loudly without it', async () => {
    // ① 没有宿主：抛错，不静默退回静态方法。
    expect(() => confirmAction(danger)).toThrow(/ConfirmProvider/)

    // ② 有宿主：走登记的实例，弹窗照常出现。
    await mount(
      <ConfirmProvider>
        <span />
      </ConfirmProvider>
    )
    await act(async () => {
      confirmAction(danger)
    })
    const modal = await waitFor(() => document.querySelector<HTMLElement>('.ant-modal'))
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('删除这段会话？')
  })

  it('closes on a failed handler without leaving an unhandled rejection', async () => {
    // 取舍写在明面上：**「弹窗留着让读者原地重试」换不来一条未处理拒绝**。
    // antd 5.29 的 hook 实例不认 `isSilent`（实测没被调用到），拒绝会沿它的 promise 链再抛一次，
    // 变成进程级未处理拒绝——日志被污染、`pnpm verify` 的测试阶段直接非零退出。
    // 三处调用点本来就在行内展示失败原因，所以关掉弹窗不会让错误消失。
    await mount(
      <ConfirmProvider>
        <span />
      </ConfirmProvider>
    )
    let calls = 0
    await act(async () => {
      confirmAction({
        ...danger,
        onConfirm: () => {
          calls += 1
          return Promise.reject(new Error('删除失败：请重试'))
        }
      })
    })
    const destructive = await waitFor(() => buttonByLabel('删除') ?? null)
    expect(destructive).not.toBeNull()
    await act(async () => {
      destructive?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 弹窗关掉、处理器只被调用一次，而且整个文件跑完没有未处理错误（vitest 会因此非零退出）。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(calls).toBe(1)
  })

  it('returns the focus to the triggering button when the dialog closes', async () => {
    // 关闭后焦点掉到 `body`，键盘读者就丢了自己刚才在哪一行。这条钉的是「还回去」。
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    let open: (() => void) | null = null
    function Trigger(): ReactElement {
      const confirm = useConfirm()
      open = () => confirm(danger)
      return <button type="button" data-trigger>delete row</button>
    }
    await act(async () => {
      root!.render(
        <ConfirmProvider>
          <Trigger />
        </ConfirmProvider>
      )
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')
    if (trigger === null) throw new Error('no trigger')
    await act(async () => {
      trigger.focus()
      open?.()
    })
    const cancel = await waitFor(() => buttonByLabel('取消') ?? null)
    expect(cancel).not.toBeNull()
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // antd 在关闭动画结束后才调 `afterClose`，所以等「焦点回到触发器」这个条件成立，不等固定时长。
    for (let attempt = 0; attempt < 120 && document.activeElement !== trigger; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
    }
    expect(document.activeElement).toBe(trigger)
  })

  it('forgets the registered instance on unmount, so a later call cannot reach a dead modal', async () => {
    await mount(
      <ConfirmProvider>
        <span />
      </ConfirmProvider>
    )
    expect(currentConfirmInstanceForTest()).not.toBeNull()
    await act(async () => {
      root!.unmount()
    })
    root = undefined
    expect(currentConfirmInstanceForTest()).toBeNull()
    expect(() => confirmAction(danger)).toThrow(/ConfirmProvider/)
  })
})
