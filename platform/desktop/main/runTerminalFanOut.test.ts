import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { JobRunTerminalHookInput } from '@platform/jobs'
import {
  fanOutRunTerminal,
  registerProductRunTerminalListener,
  resetProductRunTerminalListenersForTest
} from './runTerminalFanOut'

/**
 * `onRunTerminal` 只有一个槽，现在要同时跑两条：平台的任务失败通知（原有）+ 产品的数据变更发射器。
 *
 * 回归判据：**两个监听器都会被调用**。删掉任意一个（平台那条、产品或登记表那条），这里就红。
 * 另一个细节：一个监听器抛错不许吞掉后面的；平台不 import 产品，产品靠登记表接进来。
 */
const input = { run: { id: 'r1' }, cause: 'completed' } as unknown as JobRunTerminalHookInput

afterEach(() => {
  resetProductRunTerminalListenersForTest()
})

describe('run terminal fan-out', () => {
  it('calls the fixed listener and every registered product listener', () => {
    const fixed = vi.fn()
    const product = vi.fn()
    registerProductRunTerminalListener(product)
    const onRunTerminal = fanOutRunTerminal([fixed])
    onRunTerminal(input)
    expect(fixed).toHaveBeenCalledWith(input)
    expect(product).toHaveBeenCalledWith(input)
  })

  it('reads the registered listeners at call time, so late assembly still gets them', () => {
    const onRunTerminal = fanOutRunTerminal([vi.fn()])
    const late = vi.fn()
    registerProductRunTerminalListener(late)
    onRunTerminal(input)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('still calls the later listener when an earlier one throws, and rethrows the first error', () => {
    const failing = vi.fn(() => { throw new Error('notifier failed') })
    const product = vi.fn()
    registerProductRunTerminalListener(product)
    const onRunTerminal = fanOutRunTerminal([failing])
    expect(() => onRunTerminal(input)).toThrow('notifier failed')
    expect(failing).toHaveBeenCalledTimes(1)
    expect(product).toHaveBeenCalledTimes(1)
  })

  it('keeps the original task-failure notifier wired into the fan-out', () => {
    // 删掉任一侧（平台那条固定监听器、它内部的 wireTaskFailureNotifier、或把它交给扇出这一步）都会红：
    // 接线接缝在 `app.ts`，拼装细节在 `taskFailureNotifications.ts`（体积门禁把它抽出去的）。
    const root = process.cwd()
    const app = readFileSync(join(root, 'platform/desktop/main/app.ts'), 'utf8')
    expect(app).toContain('const taskFailureNotifier = createTaskFailureNotifier({')
    expect(app).toContain('fanOutRunTerminal([taskFailureNotifier])')
    const wiring = readFileSync(join(root, 'platform/desktop/main/taskFailureNotifications.ts'), 'utf8')
    expect(wiring).toContain('return wireTaskFailureNotifier({')
  })
})
