// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '../../shell/ShellLanguageContext'
import { resolveStateViewText } from '../state/stateViewText'
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

function mount(child: React.ReactElement, props: { reasonCode?: 'needs-restart' } = {}): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(
    <ShellLanguageProvider language="zh-CN">
      <ErrorBoundary scope="source-detail" {...props}>{child}</ErrorBoundary>
    </ShellLanguageProvider>
  ))
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

  it('says the block failed to draw, not that a read or an action failed', () => {
    // 默认原因码是 `render-failed`：读者没点任何东西、也没有读取失败，是画的时候崩了。
    // 改之前这里默认 `operation-failed`——把「你这步操作没成功」按在读者头上。
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Broken = (): React.ReactElement => {
      throw new TypeError('boom')
    }
    const container = mount(<Broken />)

    expect(container.querySelector('.state-view__title')?.textContent)
      .toBe(resolveStateViewText('zh-CN', 'ui.state.error.render-failed'))
    expect(container.querySelector('.state-view__reason')?.textContent)
      .toBe(resolveStateViewText('zh-CN', 'ui.state.error.reason.render-failed'))

    // 反向：调用点说得出更好的话时，默认值不许盖掉它。
    const overridden = mount(<Broken />, { reasonCode: 'needs-restart' })
    expect(overridden.querySelector('.state-view__reason')?.textContent)
      .toBe(resolveStateViewText('zh-CN', 'ui.state.error.reason.needs-restart'))
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
