// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { useBriefingBackgroundRunReload } from './useBriefingBackgroundRunReload'

/**
 * 列表在"跑起来"和"跑完"两个时刻各重读一次；本页自己发起的那一次不重读第二遍
 * （用户 2026-11-07：9 步全跑完、右边已经写完，左边那行还写着「未记录」——列表只在开始时重读过）。
 */

function Probe(input: Readonly<{ running: boolean; settles: number; reload: () => void }>): null {
  useBriefingBackgroundRunReload(input.running, input.reload, input.settles)
  return null
}

async function mount(initial: Readonly<{ running: boolean; settles: number; reload: () => void }>) {
  const host = document.createElement('div')
  document.body.append(host)
  let root: Root | null = createRoot(host)
  await act(async () => { root!.render(createElement(Probe, initial)) })
  const rerender = async (next: Readonly<{ running: boolean; settles: number; reload: () => void }>) => {
    await act(async () => { root!.render(createElement(Probe, next)) })
  }
  const unmount = async () => {
    await act(async () => { root!.unmount() })
    root = null
    host.remove()
  }
  return { rerender, unmount }
}

describe('the list re-reads when a run starts and when it ends', () => {
  it('reads once at the start of a background run and once when it ends', async () => {
    const reload = vi.fn()
    const { rerender, unmount } = await mount({ running: false, settles: 0, reload })
    expect(reload).toHaveBeenCalledTimes(0)

    await rerender({ running: true, settles: 0, reload })
    expect(reload, '开始时重读一次：那一行要立刻出现在 list 里').toHaveBeenCalledTimes(1)

    await rerender({ running: false, settles: 0, reload })
    expect(reload, '跑完再重读一次：行的身份（时刻/来源）这时才是真的').toHaveBeenCalledTimes(2)
    await unmount()
  })

  it('does not re-read a second time for a run this page started and already settled', async () => {
    const reload = vi.fn()
    const { rerender, unmount } = await mount({ running: true, settles: 0, reload })
    expect(reload).toHaveBeenCalledTimes(1)

    // 本页发起的那一次落定：页面已按新文档合并了那一行，settle 计数 +1。
    await rerender({ running: true, settles: 1, reload })
    expect(reload).toHaveBeenCalledTimes(1)
    await rerender({ running: false, settles: 1, reload })
    expect(reload, '同一次跑不刷两遍').toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('still re-reads at the end of the next background run after a local settle', async () => {
    const reload = vi.fn()
    const { rerender, unmount } = await mount({ running: true, settles: 3, reload })
    expect(reload).toHaveBeenCalledTimes(1)
    await rerender({ running: false, settles: 3, reload })
    expect(reload).toHaveBeenCalledTimes(2)
    await unmount()
  })

  it('reads nothing while no run is in flight', async () => {
    const reload = vi.fn()
    const { rerender, unmount } = await mount({ running: false, settles: 0, reload })
    await rerender({ running: false, settles: 1, reload })
    await rerender({ running: false, settles: 2, reload })
    expect(reload).not.toHaveBeenCalled()
    await unmount()
  })
})
