// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AppShell } from './AppShell'
import { installPlatform } from './model-service/modelServicePageHarness'

/**
 * `<html lang>` 必须等于当前界面语言。
 *
 * 缺陷现场（2026-11-03）：`index.html` 里写死 `zh-CN`，切到英文后内容全英文、这个属性没人改——
 * 读屏会拿中文语音念英文句子，断行与拼写检查也跟着错。更麻烦的是它会把验收引到错误结论：
 * 有人据此以为「中文界面出了英文文案」，其实是整页都切成了英文。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  document.documentElement.lang = 'zh-CN'
  Reflect.deleteProperty(window, 'platform')
})

describe('the document language', () => {
  /** 渲染一次壳层，等首帧设置进来。 */
  async function mountShell(): Promise<void> {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(AppShell))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('states the interface language on <html>, not the one hard-coded in index.html', async () => {
    // 英文界面：`index.html` 写死的是 `zh-CN`，属性不改就与内容不一致。
    installPlatform({ language: 'en-US' })
    document.documentElement.lang = 'zh-CN'
    await mountShell()
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('keeps saying zh-CN in a Chinese interface', async () => {
    installPlatform({ language: 'zh-CN' })
    document.documentElement.lang = 'en-US'
    await mountShell()
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
