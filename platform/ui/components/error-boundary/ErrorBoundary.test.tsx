// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** 可控子树：第一次渲染抛，之后不抛——用来验「重试后恢复」。 */
function makeFlakyChild(): { render: () => React.ReactElement; setHealthy: () => void } {
  let healthy = false
  return {
    render: () => {
      if (!healthy) throw new TypeError("Cannot read properties of undefined (reading 'unknown')")
      return <p data-recovered>内容回来了</p>
    },
    setHealthy: () => { healthy = true }
  }
}

function mount(child: React.ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<ErrorBoundary scope="source-detail">{child}</ErrorBoundary>))
  return host
}

describe('ErrorBoundary', () => {
  it('renders the shared error state instead of a blank screen, and logs the scope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Broken = (): React.ReactElement => {
      throw new TypeError("Cannot read properties of undefined (reading 'unknown')")
    }
    const container = mount(<Broken />)

    // 白屏的判据：这一块里出现了 error 态，而且是平台那套（不是自绘）。
    expect(container.querySelector('.state-view--error, .state-view[data-state="error"]')).not.toBeNull()
    // 范围进日志：崩溃时能知道是哪一块。
    expect(spy.mock.calls.some((call) => String(call[0]).includes('source-detail'))).toBe(true)
  })

  it('recovers the subtree when the reader retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const flaky = makeFlakyChild()
    const container = mount(<flaky.render />)

    const retry = container.querySelector<HTMLElement>('.state-view__action')
    expect(retry).not.toBeNull()

    // 让子树恢复健康，再点「再试一次」：边界重置 → 子树重新渲染。
    flaky.setHealthy()
    await act(async () => { retry!.click() })

    expect(container.querySelector('[data-recovered]')).not.toBeNull()
    expect(container.querySelector('.state-view--error, .state-view[data-state="error"]')).toBeNull()
  })
})
