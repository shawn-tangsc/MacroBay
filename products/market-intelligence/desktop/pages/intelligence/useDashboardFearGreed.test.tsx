// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDashboardFearGreed } from './useDashboardFearGreed'

const asOf = '2026-08-06T12:00:00.000Z'
let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren() })

describe('useDashboardFearGreed', () => {
  it('captures one mount as-of and makes one snapshot query', async () => {
    const querySnapshot = vi.fn(async () => ({ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z' }))
    const page = await renderHook({ querySnapshot }, () => new Date(asOf))
    await flush()

    expect(querySnapshot).toHaveBeenCalledWith({ asOf })
    expect(querySnapshot).toHaveBeenCalledTimes(1)
    expect(page.state()).toEqual({ state: 'available', score: '22' })
  })

  it.each([
    ['throwing clock', () => { throw new Error('unsafe') }],
    ['invalid clock', () => new Date('invalid')]
  ])('fails closed with zero queries for a %s', async (_name, now) => {
    const querySnapshot = vi.fn()
    const page = await renderHook({ querySnapshot }, now as never)
    await flush()
    expect(querySnapshot).not.toHaveBeenCalled()
    expect(page.state()).toEqual({ state: 'unavailable' })
  })

  it('does not update after unmount', async () => {
    let resolve!: (value: unknown) => void
    const querySnapshot = vi.fn(() => new Promise((done) => { resolve = done }))
    const page = await renderHook({ querySnapshot }, () => new Date(asOf))
    await act(async () => page.root.unmount())
    resolve({ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: asOf })
    await flush()
    expect(page.container.textContent).toBe('')
  })

  it('does not recapture the clock or requery after a parent rerender', async () => {
    const querySnapshot = vi.fn(async () => ({ state: 'empty', asOf }))
    const initialNow = vi.fn(() => new Date(asOf))
    const page = await renderHook({ querySnapshot }, initialNow)
    await flush()
    const replacementNow = vi.fn(() => new Date('2026-09-01T00:00:00.000Z'))
    await act(async () => page.root.render(createElement(Harness, { client: { querySnapshot }, now: replacementNow })))
    await flush()

    expect(initialNow).toHaveBeenCalledTimes(1)
    expect(replacementNow).not.toHaveBeenCalled()
    expect(querySnapshot).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the client throws or returns malformed data', async () => {
    for (const querySnapshot of [
      async () => { throw new Error('secret failure') },
      async () => ({ state: 'available', asOf, score: 22, bucket: 'fear', observedAt: asOf })
    ]) {
      const page = await renderHook({ querySnapshot }, () => new Date(asOf))
      await flush()
      expect(page.state()).toEqual({ state: 'unavailable' })
      await act(async () => page.root.unmount())
      page.container.remove()
    }
  })
})

async function renderHook(client: { querySnapshot: (input: { asOf: string }) => Promise<unknown> }, now: () => Date) {
  const container = document.createElement('div'); document.body.append(container)
  const localRoot = createRoot(container); root = localRoot
  await act(async () => localRoot.render(createElement(Harness, { client, now })))
  return { root: localRoot, container, state: () => {
    const output = container.querySelector('output')!
    return { state: output.dataset.state!, ...(output.dataset.score ? { score: output.dataset.score } : {}) }
  } }
}

function Harness({ client, now }: { client: { querySnapshot: (input: { asOf: string }) => Promise<unknown> }; now: () => Date }) {
  const state = useDashboardFearGreed({ client: client as never, now })
  return createElement('output', { 'data-state': state.state, 'data-score': state.state === 'available' ? state.score : undefined })
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
