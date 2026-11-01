import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Guards the two decisions that keep notification production honest:
 * the runtime has exactly one instance, and only the main process can produce a notification.
 * Both are cheap to break and expensive to notice: a second instance drifts its dedupe/quiet-hour
 * rules, and a `submit` on the preload surface turns the renderer into a notification source.
 */

const repoRoot = process.cwd()
const sourceRoots = ['platform', join('apps', 'desktop-shell', 'src'), 'products']

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [fullPath]
  })
}

function relativePath(filePath: string): string {
  return filePath.slice(repoRoot.length + 1)
}

describe('notification producer boundary', () => {
  it('creates the notification runtime in exactly one production place', () => {
    const allowed = new Set([
      join('platform', 'notifications', 'runtime', 'notificationRuntime.ts'),
      join('platform', 'notifications', 'ipc', 'registerNotificationIpc.ts')
    ])

    const offenders = sourceRoots.flatMap((root) =>
      listSourceFiles(join(repoRoot, root)).flatMap((filePath) => {
        if (allowed.has(relativePath(filePath))) return []
        const content = readFileSync(filePath, 'utf8')
        return /createNotificationRuntime\s*\(/.test(content) ? [relativePath(filePath)] : []
      })
    )

    expect(offenders).toEqual([])
  })

  it('keeps notification production out of the preload surface', () => {
    const preload = readFileSync(join(repoRoot, 'platform', 'desktop', 'preload', 'index.ts'), 'utf8')
    const start = preload.indexOf('  notifications: {')
    expect(start).toBeGreaterThan(-1)
    const rest = preload.slice(start + 1)
    const nextGroup = rest.search(/\n {2}[a-zA-Z]+: \{/)
    const block = nextGroup === -1 ? rest : rest.slice(0, nextGroup)
    expect(block).not.toBe('')

    const exposed = [...block.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((match) => match[1]).sort()

    // Read and state-change only. A submit/emit/create method here would let the renderer invent a
    // notification, bypassing dedupe, quiet hours and product permissions.
    expect(exposed).toEqual([
      'acknowledge',
      'dismiss',
      'getUnreadState',
      'list',
      'markAllRead',
      'markRead',
      // 订阅「记录有变化」是只读的：事件由 Main 推，渲染层不能借此写入任何东西。
      'onChanged',
      'requestDesktopPermission',
      'sendTest',
      'snooze'
    ])
  })
})
