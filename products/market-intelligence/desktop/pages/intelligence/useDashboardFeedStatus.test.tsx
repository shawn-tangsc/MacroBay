// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { useDashboardFeedStatus } from './useDashboardFeedStatus'

let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren() })

/**
 * 没有读口时，源级启用表必须结算成 **failed**（读不到），不能停在 loading：
 * 上层用 `feedState !== 'loading'` 判断「能不能按表判」，停在 loading 会让整页一处都不读、
 * 也不报错——静默停读，今晚 5 条用例被这个形状吃掉过一次。
 */
describe('useDashboardFeedStatus without any read port', () => {
  function renderWith(render: (state: ReturnType<typeof useDashboardFeedStatus>) => void): void {
    function Probe(): null {
      const state = useDashboardFeedStatus({
        client: undefined,
        crossAssetClient: undefined
      })
      render(state)
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(createElement(Probe)))
  }

  it('settles as failed instead of loading forever', () => {
    let feedState: string | undefined
    renderWith((state) => { feedState = state.feedState })
    expect(feedState).toBe('failed')
  })
})
