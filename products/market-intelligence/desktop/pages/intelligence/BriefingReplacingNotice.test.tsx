// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { BriefingReplacingNotice } from './BriefingReplacingNotice'

/** 说明组件本身两态：显示时是一个状态节点，跑完（不可见）时不留任何空壳。 */
async function renderNotice(visible: boolean, label = '上一版 · 正在重新生成'): Promise<{ host: HTMLDivElement; unmount: () => Promise<void> }> {
  const host = document.createElement('div')
  document.body.append(host)
  let root: Root | null = createRoot(host)
  await act(async () => { root!.render(createElement(BriefingReplacingNotice, { visible, label })) })
  return {
    host,
    unmount: async () => {
      await act(async () => { root!.unmount() })
      root = null
      host.remove()
    }
  }
}

describe('the previous-version notice', () => {
  it('renders as a status line carrying the given sentence', async () => {
    const { host, unmount } = await renderNotice(true)
    const note = host.querySelector('[data-briefing-previous-version]')
    expect(note).not.toBeNull()
    expect(note!.tagName).toBe('P')
    expect(note!.getAttribute('role')).toBe('status')
    expect(note!.textContent).toBe('上一版 · 正在重新生成')
    await unmount()
  })

  it('renders nothing at all once the run has settled', async () => {
    const { host, unmount } = await renderNotice(false)
    expect(host.querySelector('[data-briefing-previous-version]')).toBeNull()
    // 不显示时连空节点也不留：正文上方不许多出一条空白边框。
    expect(host.textContent).toBe('')
    await unmount()
  })
})
