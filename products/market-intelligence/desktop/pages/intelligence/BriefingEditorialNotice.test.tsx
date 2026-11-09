// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { BriefingEditorialNotice } from './BriefingEditorialNotice'
import { editorialNotice } from './dailyBriefingEditorialNotice'

const zh = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

let root: Root | undefined
let host: HTMLDivElement | undefined

async function render(code: string, regenerating = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onOpenSettings = vi.fn()
  const onRetry = vi.fn()
  await act(async () => {
    root!.render(createElement(BriefingEditorialNotice, {
      notice: editorialNotice(code, zh)!, text: zh, regenerating, onOpenSettings, onRetry
    }))
  })
  return { host, onOpenSettings, onRetry }
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
  root = undefined
  host = undefined
})

describe('the page notice offers exactly the action its case has', () => {
  it('sends a missing model to the model settings', async () => {
    const { host: node, onOpenSettings } = await render('model-unavailable')
    expect(node.querySelector('[data-editorial-notice]')?.getAttribute('data-editorial-notice')).toBe('no-model')
    const action = node.querySelector('[data-editorial-notice-action="configure"]') as HTMLButtonElement
    expect(action.textContent).toBe(zh.aiSettings.noticeAction.configure)
    action.click()
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    // 配置问题不给「重新生成」：去了也没用。
    expect(node.querySelector('[data-editorial-notice-action="regenerate"]')).toBeNull()
  })

  it('offers regenerate for a failed write, and disables it while a run is in flight', async () => {
    const { host: node, onRetry } = await render('provider-error', true)
    const action = node.querySelector('[data-editorial-notice-action="regenerate"]') as HTMLButtonElement
    expect(action.textContent).toBe(zh.aiSettings.noticeAction.regenerate)
    expect(action.disabled).toBe(true)
    action.click()
    // 单飞：运行中这颗按钮点不动，不会再起一次。
    expect(onRetry).not.toHaveBeenCalled()
    expect(node.querySelector('[data-editorial-notice-action="configure"]')).toBeNull()
  })

  it('offers no button at all when the quota is used up', async () => {
    const { host: node } = await render('provider-account-balance-insufficient')
    expect(node.querySelector('[data-editorial-notice]')?.getAttribute('data-editorial-notice')).toBe('quota')
    expect(node.querySelector('button')).toBeNull()
    expect(node.textContent).toContain('额度')
  })
})
