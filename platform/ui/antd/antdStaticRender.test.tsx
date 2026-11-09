// @vitest-environment happy-dom

import { message, Modal } from 'antd'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { installAntdStaticRender, isAntdStaticRenderInstalled } from './antdStaticRender'


afterEach(async () => {
  // 根由 antd 自己持有，用例结束前必须让它们**卸载并落定**：
  // 否则 rc-motion（CSSMotion）会在用例结束后才更新动画状态，这次更新发生在 act 之外 →
  // React 打一条 console 警告 → 此时 vitest 正在关 worker，console 走 rpc 就成了未处理拒绝。
  Modal.destroyAll()
  message.destroy()
  // 卸载本身是异步的（`unstableSetRender` 返回的销毁函数等 0ms 再 unmount），等它真的消失。
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const gone = await act(async () => {
      if (document.querySelector('.ant-modal, .ant-message') === null) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
      return document.querySelector('.ant-modal, .ant-message') === null
    })
    if (gone) break
  }
  // 销毁函数本身在 0ms 之后才 unmount：这一步留在用例里，不让它落到环境拆除之后。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  document.body.replaceChildren()
})

/**
 * 等一个条件真的成立，而不是等一拍固定时长：静态入口是异步挂载的，
 * 条件一成立就返回，上限用完才红。上限按「次数 × 10ms」算，不读系统时钟。
 */
async function waitUntil(condition: () => boolean, what: string, attempts = 100): Promise<void> {
  // 条件与等待都在**同一个 act 步**里：antd 的静态入口在自己的定时器里排渲染，
  // 把「判断」留在 act 外面会让两次 act 之间冒出一次 act 之外的更新（React 打 act 警告）。
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const settled = await act(async () => {
      if (condition()) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
      return condition()
    })
    if (settled) return
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('antd static render', () => {
  it('puts a real confirm dialog into the document instead of silently doing nothing', async () => {
    installAntdStaticRender()
    expect(isAntdStaticRenderInstalled()).toBe(true)

    await act(async () => {
      Modal.confirm({ title: '确认清空模型' })
    })
    // antd 的静态方法异步挂载：等标题真的进 DOM，不等固定一拍。
    await waitUntil(
      () => document.body.textContent?.includes('确认清空模型') === true,
      'the static confirm dialog to mount'
    )

    // 这条断言的就是今天那个 bug：没有补丁时 body 里一个节点都没有。
    expect(document.body.textContent).toContain('确认清空模型')
    expect(document.body.innerHTML.length).toBeGreaterThan(0)
  })

  it('also makes the static message API visible, so those calls stop being no-ops', async () => {
    installAntdStaticRender()

    await act(async () => {
      void message.open({ content: '设置已保存', duration: 0 })
    })
    await waitUntil(
      () => document.body.textContent?.includes('设置已保存') === true,
      'the static message to mount'
    )

    // 补丁之前 message.* 是静默空操作：发了、也没有节点。这一条正是那 6 个文件的前提。
    expect(document.body.textContent).toContain('设置已保存')
  })

  it('only takes over the renderer once, however many entries call it', () => {
    installAntdStaticRender()
    installAntdStaticRender()
    expect(isAntdStaticRenderInstalled()).toBe(true)
  })
})
