// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { useBriefingBackgroundRunReload } from './useBriefingBackgroundRunReload'

/**
 * 列表在"跑起来"和"跑完"两个时刻各重读一次；本页自己发起的那一次不重读第二遍
 * （用户 2026-11-07：9 步全跑完、右边已经写完，左边那行还写着「未记录」——列表只在开始时重读过）。
 */

function Probe(input: Readonly<{ running: boolean; reload: () => void; onMount: (mark: () => void) => void }>): null {
  const { markLocalSettled } = useBriefingBackgroundRunReload(input.running, input.reload)
  input.onMount(markLocalSettled)
  return null
}

async function mount(initial: Readonly<{ running: boolean; reload: () => void }>) {
  const host = document.createElement('div')
  document.body.append(host)
  let root: Root | null = createRoot(host)
  let mark: () => void = () => undefined
  const props = { ...initial, onMount: (next: () => void) => { mark = next } }
  await act(async () => { root!.render(createElement(Probe, props)) })
  const rerender = async (next: Readonly<{ running: boolean; reload: () => void }>) => {
    await act(async () => { root!.render(createElement(Probe, { ...next, onMount: (m: () => void) => { mark = m } })) })
  }
  /** 模拟"本页自己发起的那次跑落定"：页面调的就是这个回调。 */
  const settle = async () => { await act(async () => { mark() }) }
  const unmount = async () => {
    await act(async () => { root!.unmount() })
    root = null
    host.remove()
  }
  return { rerender, settle, unmount }
}

describe('the list re-reads when a run starts and when it ends', () => {
  it('reads once at the start of a background run and once when it ends', async () => {
    const reload = vi.fn()
    const { rerender, unmount } = await mount({ running: false, reload })
    expect(reload).toHaveBeenCalledTimes(0)

    await rerender({ running: true, reload })
    expect(reload, '开始时重读一次：那一行要立刻出现在 list 里').toHaveBeenCalledTimes(1)

    await rerender({ running: false, reload })
    expect(reload, '跑完再重读一次：行的身份（时刻/来源）这时才是真的').toHaveBeenCalledTimes(2)
    await unmount()
  })

  it('does not re-read a second time for a run this page started and already settled', async () => {
    const reload = vi.fn()
    const { rerender, settle, unmount } = await mount({ running: true, reload })
    expect(reload).toHaveBeenCalledTimes(1)

    // 本页发起的那一次落定：页面已按新文档合并了那一行。
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
    await rerender({ running: false, reload })
    expect(reload, '同一次跑不刷两遍').toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('still re-reads at the end of the next background run after a local settle', async () => {
    const reload = vi.fn()
    const { rerender, unmount } = await mount({ running: true, reload })
    expect(reload).toHaveBeenCalledTimes(1)
    await rerender({ running: false, reload })
    expect(reload).toHaveBeenCalledTimes(2)
    await unmount()
  })

  it('reads nothing while no run is in flight', async () => {
    const reload = vi.fn()
    const { rerender, settle, unmount } = await mount({ running: false, reload })
    await settle()
    await settle()
    await rerender({ running: false, reload })
    expect(reload).not.toHaveBeenCalled()
    await unmount()
  })
})
