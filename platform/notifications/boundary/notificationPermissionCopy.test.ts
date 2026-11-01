import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 6b「权限不撒谎」的红法：**文案里出现「已授权」「已被系统关闭」这类断言 → 扫描红**。
 *
 * 原因不是措辞偏好，而是我们**查不到**这个状态：Electron 41 没有 `getNotificationSettings()`，
 * `Notification.failed` 仅 win32，`Notification.isSupported()` 只说明平台支持通知。所以任何一句
 * 「已授权/已被关闭」都是编出来的事实；它比代码撒谎更难发现，因为它看起来像设计选择。
 *
 * 扫描范围刻意限定在 `platformText` 的 `notifications` 两段（中/英）：那里是这个能力唯一收文案的地方。
 */
const PLATFORM_TEXT = resolve(__dirname, '../../../apps/desktop-shell/src/renderer/src/i18n/platformText.ts')

function notificationCopyBlocks(): string[] {
  const source = readFileSync(PLATFORM_TEXT, 'utf8')
  const blocks: string[] = []
  const pattern = /\n {4}notifications: \{([\s\S]*?)\n {4}\},/g
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) blocks.push(match[1])
  }
  return blocks
}

describe('6b: notification copy never asserts a permission state we cannot read', () => {
  it('scans both locale blocks', () => {
    expect(notificationCopyBlocks().length).toBeGreaterThanOrEqual(2)
  })

  it('never claims the system has authorized or blocked desktop notifications', () => {
    const forbidden = /已授权|已被系统关闭|已被系统拦截|已被拦截|is authorized|has been blocked by the system/i
    for (const block of notificationCopyBlocks()) {
      expect(block).not.toMatch(forbidden)
    }
  })
})
