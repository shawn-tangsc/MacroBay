import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { expect } from 'vitest'

/**
 * 「等的时候画的是加载态，不是终态」的断言（`MI-11-R161`）。
 *
 * 这是唯一能抓住「把加载写成 unavailable」的手段：那种写法**类型完全正确**
 * （`AsyncState` 的 `error` 分支带 `reasonCode`，只要挑一个码就能编译过），
 * 而用户看到的是「加载中先闪一下读取失败」。所以判据落在**首帧的 DOM**上：
 *
 * 1. 解析之前，`[data-state]` 里不许出现 `error` / `empty` / `disabled` / `permission`；
 * 2. 必须存在 `[data-loading-state]`（平台加载组件的标记）。
 *
 * 用法：渲染一个**读取还没解析**的界面，把它包进来；读的 promise 由用例自己控制。
 */
const SETTLED_STATES = ['error', 'empty', 'disabled', 'permission']

export async function expectWaitingFirst(element: ReactElement): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  try {
    await act(async () => {
      root.render(element)
    })

    const settled = [...host.querySelectorAll('[data-state]')]
      .map((node) => node.getAttribute('data-state'))
      .filter((state): state is string => state !== null && SETTLED_STATES.includes(state))

    expect(settled, '首帧画了终态：读还在进行，界面却已经说读完了').toEqual([])
    expect(host.querySelector('[data-loading-state]'), '首帧没有加载态').not.toBeNull()
  } finally {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  }
}
