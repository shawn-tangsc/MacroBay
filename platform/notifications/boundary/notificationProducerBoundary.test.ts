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
      // 投递设置：读写的是「读者要不要」，不是「谁可以产生一条通知」。
      // 订阅层撤销后只剩两个总开关 + 情报三条的频道开关（契约 §5.1 / §5.4）。
      'getChannelEvents',
      'getDeliverySettings',
      'getUnreadState',
      'list',
      'listEventCatalog',
      'markAllRead',
      'markRead',
      // 两条订阅都是只读：事件由 Main 推，渲染层不能借此写入任何东西。
      'onChanged',
      'onDelivered',
      'readDesktopPermission',
      // 读者的显式「再推一次」：只重投这一条的手机一面，不是生产者。
      'redeliverPush',
      'sendTest',
      'setChannelEvent',
      'setDesktopEnabled',
      'setToastEnabled',
      'snooze'
    ])
  })

  it('never lets an automatic producer take the "record but do not deliver" door', () => {
    // `deliver: false` 只给读者动作（手动重新生成）用。自动路径带上它，等于给所有生产者一个
    // 「静默改写记录、什么都没发」的口子——记录在、投递没了，读者会看到一条谁都没收到过的通知。
    const producers = listSourceFiles(join(repoRoot, 'platform', 'notifications', 'producers'))
    expect(producers.length).toBeGreaterThan(0)
    const offenders = producers.filter((filePath) => /deliver\s*:\s*false/.test(readFileSync(filePath, 'utf8')))
    expect(offenders.map(relativePath)).toEqual([])
  })
})
