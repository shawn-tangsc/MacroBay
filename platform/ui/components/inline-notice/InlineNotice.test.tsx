// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InlineNotice } from './InlineNotice'

/**
 * 三档提示条的判据：**角色跟着语义走**（danger = alert，其余 = status）、**颜色只由档位决定**、
 * 一行文字（不铺长句）。不留可关闭的浮层——它跟着状态在位。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  return host
}

describe('inline notice', () => {
  it('gives danger the alert role and the other two the status role', async () => {
    expect((await mount(<InlineNotice tone="danger">保存失败</InlineNotice>)).querySelector('[data-inline-notice="danger"]')?.getAttribute('role')).toBe('alert')
    expect((await mount(<InlineNotice tone="caution">配置不完整</InlineNotice>)).querySelector('[data-inline-notice="caution"]')?.getAttribute('role')).toBe('status')
    expect((await mount(<InlineNotice tone="info">提示</InlineNotice>)).querySelector('[data-inline-notice="info"]')?.getAttribute('role')).toBe('status')
  })

  it('renders an optional action on the right, with the resolved label, and fires it', async () => {
    const onSelect = vi.fn()
    const host = await mount(<InlineNotice action={{ labelKey: 'go', onSelect }} resolveText={() => '去配置'} tone="caution">
      搜索源没配
    </InlineNotice>)
    const button = host.querySelector<HTMLButtonElement>('.inline-notice__action')!
    expect(button.textContent).toBe('去配置')
    await act(async () => button.click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    // 文字按钮：不是靠颜色区分的链接样式。
    expect(button.tagName).toBe('BUTTON')
  })

  it('carries the tone as a class and renders one line of text with an icon', async () => {
    const host = await mount(<InlineNotice tone="caution">配置不完整，功能降级</InlineNotice>)
    const notice = host.querySelector('.inline-notice')!
    expect(notice.className).toContain('inline-notice--caution')
    expect(notice.querySelector('svg')).not.toBeNull()
    expect(notice.querySelector('.inline-notice__text')?.textContent).toBe('配置不完整，功能降级')
    // 不可关闭：没有关闭按钮。
    expect(notice.querySelector('button')).toBeNull()
  })
})
