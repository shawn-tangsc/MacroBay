/**
 * 渲染层拿不到键——这条守卫守的是**结构**，不是记性。
 *
 * 今晚的现场：`SafeNotificationRecord` 把 `titleKey` 通过 IPC 交给渲染层，渲染层只有平台那张表，
 * 产品键查不到就 `?? record.titleKey`，于是屏幕上躺着
 * `notification.event.market-intelligence.briefing.ready.title`（验收 N24①）。
 *
 * 现在句子在主进程读的那一刻解析好，渲染层收到的是 `NotificationCenterItem`：没有键、没有参数表、
 * 没有解析函数。这份用例把那条路钉死：**键回到渲染层，就先红在这里**。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..', '..')
const renderer = join(root, 'apps/desktop-shell/src/renderer/src')
const notificationsDir = join(renderer, 'shell/notifications')

function sources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sources(path))
      continue
    }
    if (/\.tsx?$/.test(entry)) found.push(path)
  }
  return found
}

describe('渲染层不查文案表、不碰键', () => {
  it('渲染层的解析入口已经删掉，不是留着备用', () => {
    // 「留着一个纯函数给别人用」正是露键的源头：它在，就总会有人再调一次。
    expect(() => statSync(join(notificationsDir, 'notificationText.ts'))).toThrow()
  })

  it('渲染层只有外壳文案聚合点可以 import 文案表，记录路径一个都不许', () => {
    const allowed = ['i18n/platformText.ts']
    const offenders = sources(renderer)
      .filter((path) => readFileSync(path, 'utf8').includes("from '@platform/i18n/notificationCopy'"))
      .map((path) => relative(renderer, path))
    // `platformText.ts` 是外壳文案的唯一聚合点，取的是「为什么没弹到桌面」这类**外壳自有**的句子，
    // 不是拿一条记录去查表。除此之外任何一处出现，都是把键这条路重新打开。
    expect(offenders.sort()).toEqual(allowed)
  })

  it('通知这条路径上不再出现 titleKey / bodyKey / reasonKey，也没有键形态的串', () => {
    const offenders = sources(notificationsDir)
      .filter((path) => /\.test\.tsx?$/.test(path) === false)
      // 只盯「拿记录的键」，不盯组件自己的同名 prop（抽屉标题那个 `titleKey` 是组件 API）。
      .filter((path) => /\brecord\.(titleKey|bodyKey|reasonKey|labelKey)\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(notificationsDir, path))
    expect(offenders).toEqual([])

    // 键形态的串（`notification.event.…`）在渲染层没有来源：文案全在主进程解析。
    const keyShaped = sources(notificationsDir)
      // 用例里可以拿键形态的串做**反向**断言（断言它不出现），实现文件里一个都不许有。
      .filter((path) => /\.test\.tsx?$/.test(path) === false)
      .filter((path) => /notification\.(event|taskFailed|fallback)\./.test(readFileSync(path, 'utf8')))
      .map((path) => relative(notificationsDir, path))
    expect(keyShaped).toEqual([])
  })

  it('IPC 出口不再把记录原样交出去（那会把键一起带过界）', () => {
    const ipc = readFileSync(join(root, 'platform/notifications/ipc/registerNotificationIpc.ts'), 'utf8')
    expect(ipc).not.toContain('toSafeNotificationRecord')
    expect(ipc).toContain('toCenterItem')
  })
})
