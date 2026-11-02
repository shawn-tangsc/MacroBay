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
    // 命名空间已从 `preload/index.ts` 抽成模块（接缝文件要薄、体积门禁也在卡）。
    // 守卫因此读**模块**，同时核对预加载确实只挂载它、没有把 `submit` 之类漏出来。
    const preload = readFileSync(join(repoRoot, 'platform', 'desktop', 'preload', 'index.ts'), 'utf8')
    expect(preload).toContain('createNotificationsNamespace(ipcRenderer)')

    const namespace = readFileSync(
      join(repoRoot, 'platform', 'desktop', 'preload', 'namespaces', 'notifications.ts'),
      'utf8'
    )
    const exposed = [...namespace.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((match) => match[1]).sort()
    expect(exposed.length).toBeGreaterThan(0)

    // Read and state-change only. A submit/emit/create method here would let the renderer invent a
    // notification, bypassing dedupe, quiet hours and product permissions.
    expect(exposed).toEqual([
      'acknowledge',
      // 删除已读是**数据操作**，不是生产者：它只能删掉已存在的记录，不能凭空造一条。
      'deleteRead',
      'dismiss',
      'getUnreadState',
      'list',
      'markAllRead',
      'markRead',
      // 两条订阅都是只读：事件由 Main 推，渲染层不能借此写入任何东西。
      'onChanged',
      'onDelivered',
      'readDesktopPermission',
      'sendTest',
      'snooze'
    ])
  })
})
