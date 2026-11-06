// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { renderWithConfirm, testConfirmProps } from './confirmTestSupport'
import { useConfirm } from './ConfirmProvider'

/**
 * 共用测试入口自己的用例。
 *
 * 它是给九个产品测试文件用的**唯一入口**，所以它自己必须先被证明能用：能开出弹窗、能点按钮、
 * 能读到文案。否则大家套了一层「看起来有 Provider」的壳，实际什么都没验。
 */

function Widget(): React.ReactElement {
  const confirm = useConfirm()
  return (
    <button onClick={() => confirm(testConfirmProps())} type="button">
      open
    </button>
  )
}

describe('renderWithConfirm', () => {
  it('mounts the ui inside a provider, so a component can open a dialog', async () => {
    const view = renderWithConfirm(<Widget />)
    expect(view.host.querySelector('button')).not.toBeNull()
    expect(document.querySelector('.ant-modal')).toBeNull()

    view.host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const dialog = await view.waitForDialog()
    expect(dialog).not.toBeNull()
    expect(view.dialogText()).toContain('Delete this?')
    await view.unmount()
  })

  it('clicks the real dialog button and throws loudly when the label is wrong', async () => {
    const view = renderWithConfirm(<Widget />)
    view.host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await view.waitForDialog()
    await expect(view.clickDialogButton('不存在')).rejects.toThrow(/no button labelled/)
    await view.clickDialogButton('Cancel')
    await view.unmount()
  })
})
