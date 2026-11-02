// @vitest-environment happy-dom

import { message, Modal } from 'antd'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { installAntdStaticRender, isAntdStaticRenderInstalled } from './antdStaticRender'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
})

describe('antd static render', () => {
  it('puts a real confirm dialog into the document instead of silently doing nothing', async () => {
    installAntdStaticRender()
    expect(isAntdStaticRenderInstalled()).toBe(true)

    await act(async () => {
      Modal.confirm({ title: '确认清空模型' })
      // antd 的静态方法异步挂载，等一拍让渲染器接上。
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    // 这条断言的就是今天那个 bug：没有补丁时 body 里一个节点都没有。
    expect(document.body.textContent).toContain('确认清空模型')
    expect(document.body.innerHTML.length).toBeGreaterThan(0)
  })

  it('also makes the static message API visible, so those calls stop being no-ops', async () => {
    installAntdStaticRender()

    await act(async () => {
      void message.open({ content: '设置已保存', duration: 0 })
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    // 补丁之前 message.* 是静默空操作：发了、也没有节点。这一条正是那 6 个文件的前提。
    expect(document.body.textContent).toContain('设置已保存')
  })

  it('only takes over the renderer once, however many entries call it', () => {
    installAntdStaticRender()
    installAntdStaticRender()
    expect(isAntdStaticRenderInstalled()).toBe(true)
  })
})
