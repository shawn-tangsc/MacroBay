import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { confirmAction, type ConfirmProps } from './Confirm'

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }))
vi.mock('antd', () => ({ Modal: { confirm: confirmMock } }))

const source = readFileSync(join(__dirname, 'Confirm.tsx'), 'utf8')

function lastOptions(): Record<string, unknown> {
  return confirmMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('confirmAction', () => {
  it('passes every string through and keeps no copy of its own', () => {
    confirmAction({
      title: 'Delete this conversation?',
      description: 'Deleted conversations cannot be restored.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
      onConfirm: () => undefined
    })

    expect(lastOptions()).toMatchObject({
      title: 'Delete this conversation?',
      content: 'Deleted conversations cannot be restored.',
      okText: 'Delete',
      cancelText: 'Keep it'
    })
  })

  it('uses the danger button and puts initial focus on cancel for destructive actions', () => {
    confirmAction({
      title: 'Delete',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => undefined
    })

    expect(lastOptions().okButtonProps).toEqual({ danger: true })
    expect(lastOptions().autoFocusButton).toBe('cancel')
  })

  it('keeps focus on confirm for ordinary actions', () => {
    confirmAction({
      title: 'Apply',
      confirmLabel: 'Apply',
      cancelLabel: 'Cancel',
      tone: 'default',
      onConfirm: () => undefined
    })

    expect(lastOptions().okButtonProps).toBeUndefined()
    expect(lastOptions().autoFocusButton).toBe('ok')
  })

  it('lets a rejected confirm keep the dialog open instead of swallowing the error', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('write failed')
    })
    confirmAction({
      title: 'Delete',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm
    })

    const onOk = lastOptions().onOk as () => Promise<void>
    await expect(onOk()).rejects.toThrow('write failed')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('never falls back to the native confirm or to an internal default string', () => {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(withoutComments).not.toContain('window.confirm')
    expect(withoutComments).not.toMatch(/[\u4e00-\u9fa5]/)
    // 默认文案一旦存在，七个调用点就会长出七种「确定」。
    expect(withoutComments).not.toMatch(/'OK'|"OK"|'Cancel'|"Cancel"|'确定'/)
  })
})

/** 编译期契约：四个字符串字段与 tone 全部必填，缺一个就编译不过。 */
export function confirmTypeContract(): void {
  // @ts-expect-error confirmLabel 必填
  const noConfirmLabel: ConfirmProps = {
    title: 'Delete',
    cancelLabel: 'Cancel',
    tone: 'danger',
    onConfirm: () => undefined
  }
  // @ts-expect-error cancelLabel 必填
  const noCancelLabel: ConfirmProps = {
    title: 'Delete',
    confirmLabel: 'Delete',
    tone: 'danger',
    onConfirm: () => undefined
  }
  // @ts-expect-error tone 必填，不给默认值
  const noTone: ConfirmProps = {
    title: 'Delete',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    onConfirm: () => undefined
  }
  // @ts-expect-error tone 只允许 default | danger
  const badTone: ConfirmProps = {
    title: 'Delete',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    tone: 'warning',
    onConfirm: () => undefined
  }
  void noConfirmLabel
  void noCancelLabel
  void noTone
  void badTone
}
