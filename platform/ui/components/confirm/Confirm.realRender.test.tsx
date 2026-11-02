// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import { installAntdStaticRender } from '../../antd/antdStaticRender'
import { confirmAction } from './Confirm'

/**
 * 真渲染用例：不 mock antd。
 *
 * 之前的用例 mock 掉整个 `antd`，只能证明「`autoFocusButton` 传了 `cancel`」，证明不了
 * 危险动作的初始焦点**真的**落在取消上。补丁（`platform/ui/antd/antdStaticRender.ts`）落地后，
 * 这条才验得动：按住回车连击时，焦点在破坏性按钮上就是连续执行。
 */

afterEach(() => {
  document.body.replaceChildren()
})

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('confirmAction in a real render', () => {
  it('puts the initial focus on cancel, not on the destructive button', async () => {
    installAntdStaticRender()

    confirmAction({
      title: '清空全部模型？',
      description: '清空后需要重新拉取模型列表。',
      confirmLabel: '清空',
      cancelLabel: '取消',
      tone: 'danger',
      onConfirm: () => undefined
    })
    await settle()

    // 测试里没有全局 ConfigProvider，antd 会在两个汉字之间插空格（「取 消」）；比较时去掉空白。
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
    const label = (button: HTMLButtonElement): string => (button.textContent ?? '').replace(/\s/g, '')
    const cancel = buttons.find((button) => label(button) === '取消')
    const destructive = buttons.find((button) => label(button) === '清空')

    expect(cancel, '确认框没有渲染出取消按钮').toBeTruthy()
    expect(destructive?.className).toContain('ant-btn-dangerous')
    // 这条就是界面设计要的那一格：初始焦点在取消上，不在破坏性按钮上。
    expect(document.activeElement).toBe(cancel)
  })

  it('keeps focus on confirm for an ordinary action', async () => {
    installAntdStaticRender()

    confirmAction({
      title: '应用更改？',
      confirmLabel: '应用',
      cancelLabel: '取消',
      tone: 'default',
      onConfirm: () => undefined
    })
    await settle()

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
    const confirm = buttons.find((button) => (button.textContent ?? '').replace(/\s/g, '') === '应用')
    expect(document.activeElement).toBe(confirm)
  })
})
