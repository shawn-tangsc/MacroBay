import { describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import type { NotificationCopyTableSet } from '@platform/notifications/contracts/notificationCopyPort'

import { productNotificationCopyTables } from './notificationCopyTables'
import { createNotificationCopyPort } from '@platform/notifications/contracts/notificationCopyPort'
import { notificationCopy } from '@platform/i18n/notificationCopy'

const CUP = {
  'zh-CN': { 'notification.event.cup.ready.title': '好了' },
  'en-US': { 'notification.event.cup.ready.title': 'Ready' }
} satisfies NotificationCopyTableSet

function manifest(id: string, notificationCopy?: NotificationCopyTableSet): ProductManifest {
  return { id, ...(notificationCopy === undefined ? {} : { notificationCopy }) } as unknown as ProductManifest
}

/**
 * 文案表随 manifest 注入（契约 §3.3）：这一条守的是「平台不 import 产品代码」的替代路径——
 * 装配只认 `manifest.notificationCopy`，不认识任何产品名。
 */
describe('product notification copy tables', () => {
  it('collects the table each manifest declares, keyed by its id', () => {
    const tables = productNotificationCopyTables([manifest('cup', CUP)])
    expect(tables).toEqual({ cup: CUP })
  })

  it('leaves products that declare no table out, so their copy resolves to nothing rather than a wrong table', () => {
    const tables = productNotificationCopyTables([manifest('cup', CUP), manifest('mug')])
    expect(Object.keys(tables)).toEqual(['cup'])
    // 没有表 → 解析不到 → 调用方退平台兜底句，不许把键名露出来。
    const port = createNotificationCopyPort({ platform: notificationCopy, products: tables })
    expect(port.resolve({ scope: 'product', productId: 'mug', key: 'notification.event.cup.ready.title' }, 'zh-CN')).toBeNull()
  })

  it('resolves a declared product key in both languages, and never another product’s table', () => {
    const port = createNotificationCopyPort({
      platform: notificationCopy,
      products: productNotificationCopyTables([manifest('cup', CUP)])
    })
    expect(port.resolve({ scope: 'product', productId: 'cup', key: 'notification.event.cup.ready.title' }, 'zh-CN')).toBe('好了')
    expect(port.resolve({ scope: 'product', productId: 'cup', key: 'notification.event.cup.ready.title' }, 'en-US')).toBe('Ready')
    expect(port.resolve({ scope: 'product', productId: 'mug', key: 'notification.event.cup.ready.title' }, 'en-US')).toBeNull()
  })
})
