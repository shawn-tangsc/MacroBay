import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { ConfirmProps } from './Confirm'
import { confirmOptions } from './confirmOptions'

/**
 * 选项构造是**纯函数**：确认框长什么样与它由谁渲染无关，所以这里不渲染、不 mock。
 *
 * 为什么把测试从 `Modal.confirm` 挪到这里：静态方法站在 React 树外、只吃默认主题——深色界面弹
 * 浅色框就是这么来的。渲染位置由 `ConfirmProvider` 负责（另一份用例），这里只证明**选项本身**
 * 没有漂移：四个字符串原样透传、危险档焦点在取消、组件里没有一句自造文案。
 */

const builder = readFileSync(join(__dirname, 'confirmOptions.ts'), 'utf8')
const component = readFileSync(join(__dirname, 'Confirm.tsx'), 'utf8')
const provider = readFileSync(join(__dirname, 'ConfirmProvider.tsx'), 'utf8')

function options(overrides: Partial<ConfirmProps> = {}): Record<string, unknown> {
  return confirmOptions({
    title: 'Delete this conversation?',
    description: 'Deleted conversations cannot be restored.',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep it',
    tone: 'danger',
    onConfirm: () => undefined,
    ...overrides
  }) as unknown as Record<string, unknown>
}

describe('confirm options', () => {
  it('passes every string through and keeps no copy of its own', () => {
    expect(options()).toMatchObject({
      title: 'Delete this conversation?',
      content: 'Deleted conversations cannot be restored.',
      okText: 'Delete',
      cancelText: 'Keep it'
    })
  })

  it('uses the danger button and puts initial focus on cancel for destructive actions', () => {
    expect(options().okButtonProps).toEqual({ danger: true })
    expect(options().autoFocusButton).toBe('cancel')
  })

  it('keeps focus on confirm for ordinary actions', () => {
    const plain = options({ tone: 'default' })
    expect(plain.okButtonProps).toBeUndefined()
    expect(plain.autoFocusButton).toBe('ok')
  })

  it('lets a rejected confirm keep the dialog open instead of swallowing the error', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('write failed')
    })
    const onOk = options({ onConfirm }).onOk as () => Promise<void>
    await expect(onOk()).rejects.toThrow('write failed')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('never falls back to the native confirm or to an internal default string', () => {
    const code = builder.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(code).not.toContain('window.confirm')
    expect(code).not.toMatch(/[\u4e00-\u9fa5]/)
    // 默认文案一旦存在，七个调用点就会长出七种「确定」。
    expect(code).not.toMatch(/'OK'|"OK"|'Cancel'|"Cancel"|'确定'/)
  })

  it('constructs the options in exactly one place, so two render paths cannot drift', () => {
    // `ConfirmProvider`（树内实例）与遗留的 `confirmAction` 都必须走这一份构造。
    expect(provider).toContain('confirmOptions(')
    expect(component).toContain('confirmOptions(')
    // 而且两边都不许自己拼选项：`okText:` / `autoFocusButton:` 只许出现在构造器里。
    for (const text of [provider, component]) {
      expect(text).not.toMatch(/okText\s*:/)
      expect(text).not.toMatch(/autoFocusButton\s*:/)
    }
  })

  it('never reaches for the static modal, whose only defect is where it renders', () => {
    // 静态入口站在 React 树外 ⇒ 只吃 antd 默认主题，这正是「深色窗口弹浅色框」的成因。
    // 守的是**整个目录**，不是列出来的三个文件：以后谁在这个目录里加一个文件、顺手用静态方法，
    // 它必须当场红，而不是等到某一个窗口里再被肉眼发现。
    const files = readdirSync(__dirname).filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files
      .filter((name) => readFileSync(join(__dirname, name), 'utf8').includes('Modal.confirm('))
      .map((name) => `confirm/${name}`)
    expect(offenders).toEqual([])
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
