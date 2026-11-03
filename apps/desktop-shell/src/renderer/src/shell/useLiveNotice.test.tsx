// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText, type PlatformText } from '../i18n/platformText'
import { resolveLiveText } from './liveText'
import { useLiveNotice } from './useLiveNotice'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Harness(props: {
  text: PlatformText
  expose: (api: ReturnType<typeof useLiveNotice>) => void
}): React.ReactElement {
  const live = useLiveNotice()
  props.expose(live)
  return createElement('span', { id: 'notice' }, resolveLiveText(live.notice, props.text) ?? '')
}

/**
 * 界面验收的两条硬伤之一：**提示的语言曾经被冻结在保存那一刻**。
 * 这两条用例把「存函数、渲染时解析」钉住：同一份状态，换一份当前语言的文案表，显示就要跟着变。
 */
describe('save notice follows the interface language', () => {
  it('shows the saved notice in whichever language is current at render time', async () => {
    let api: ReturnType<typeof useLiveNotice> | null = null
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(Harness, { text: platformText['zh-CN'], expose: (next) => (api = next) }))
    })
    await act(async () => api!.showSaved())
    expect(container.querySelector('#notice')?.textContent).toBe('已保存')

    // 切语言只是换了一份文案表：状态里没有句子，所以这句话跟着变。
    await act(async () => {
      root!.render(createElement(Harness, { text: platformText['en-US'], expose: (next) => (api = next) }))
    })
    expect(container.querySelector('#notice')?.textContent).toBe('Saved')
  })

  it('does the same for a failed save', async () => {
    let api: ReturnType<typeof useLiveNotice> | null = null
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(createElement(Harness, { text: platformText['en-US'], expose: (next) => (api = next) }))
    })
    await act(async () => api!.showSaveFailed(new Error('disk full')))
    expect(container.querySelector('#notice')?.textContent).toContain('Save failed')

    await act(async () => {
      root!.render(createElement(Harness, { text: platformText['zh-CN'], expose: (next) => (api = next) }))
    })
    expect(container.querySelector('#notice')?.textContent).toContain('保存失败')
  })
})
