// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'

import { ConfigSettingsDrawer } from './ConfigSettingsDrawer'

/**
 * 关窗确认框的四个判据（界面设计 2026-11-10 签字，第三条是她加的）：
 *
 * - 「丢掉改动」**静止就红**（`ant-btn-dangerous`），不是悬停才红；
 * - 默认焦点在「继续编辑」；
 * - 框里按 Esc = 继续编辑（抽屉不关、改动还在）；
 * - 只有脏才弹。
 *
 * 这里用的是**真实的宿主接线**（`useConfirm` → `confirmDiscard`），不是假的回调——
 * 假的只能证明「问了一次」，证明不了读者看到的那颗红键与焦点。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Probe({ isDirty }: { isDirty: boolean }): React.ReactElement {
  const confirm = useConfirm()
  return <ConfigSettingsDrawer
    confirmDiscard={(input) => confirm({
      title: input.title,
      description: input.body,
      confirmLabel: input.confirmLabel,
      cancelLabel: input.cancelLabel,
      tone: 'danger',
      onConfirm: input.onDiscard
    })}
    initialMenu="briefing"
    isScreenDirty={() => isDirty}
    onClose={() => undefined}
    open />
}

async function mount(isDirty: boolean): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(<ConfirmProvider><Probe isDirty={isDirty} /></ConfirmProvider>))
  await act(async () => { await Promise.resolve() })
}

async function askForClose(): Promise<void> {
  const close = document.body.querySelector<HTMLElement>('.drawer__header-actions button')!
  await act(async () => { close.click(); await Promise.resolve() })
}

const buttonByLabel = (label: string): HTMLButtonElement | undefined =>
  [...document.body.querySelectorAll<HTMLButtonElement>('.ant-modal-confirm-btns button')]
    .find((button) => (button.textContent ?? '').replace(/\s+/gu, '') === label)

describe('the discard confirmation', () => {
  it('draws the destructive choice red at rest and focuses 继续编辑', async () => {
    await mount(true)
    await askForClose()
    const discard = buttonByLabel('丢掉改动')!
    expect(discard.className).toContain('ant-btn-dangerous')
    expect((document.activeElement as HTMLElement | null)?.textContent?.replace(/\s+/gu, '')).toBe('继续编辑')
  })

  it('keeps editing when Escape is pressed inside the confirmation', async () => {
    const onClose = vi.fn()
    function Probe2(): React.ReactElement {
      const confirm = useConfirm()
      return <ConfigSettingsDrawer
        confirmDiscard={(input) => confirm({ title: input.title, description: input.body, confirmLabel: input.confirmLabel, cancelLabel: input.cancelLabel, tone: 'danger', onConfirm: input.onDiscard })}
        initialMenu="briefing"
        isScreenDirty={() => true}
        onClose={onClose}
        open />
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(<ConfirmProvider><Probe2 /></ConfirmProvider>))
    await act(async () => { await Promise.resolve() })
    await askForClose()

    const dialog = document.querySelector('.ant-modal-confirm')
    expect(dialog).not.toBeNull()
    // 「继续编辑」是默认焦点：Esc 从它身上发出，等于按了它（antd 的 Esc = 取消）。
    const cancel = buttonByLabel('继续编辑')!
    cancel.focus()
    await act(async () => {
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
      await Promise.resolve()
    })
    // 能断的那一半：Esc 绝不会走到「丢掉改动」（onClose 一次都没被调）。
    // 另一半（弹窗随之关闭）归 antd Modal 的 `keyboard` → `onCancel`，happy-dom 里驱动不了这个
    // 键盘路径（把同样的 Esc 发给 wrap/content/document 都不触发），所以这里不假装断到它——
    // 断假绿比少一条更糟。
    expect(onClose).not.toHaveBeenCalled()
  })
})
