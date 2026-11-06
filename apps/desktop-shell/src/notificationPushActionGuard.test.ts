/**
 * 推送文案不许写动作指令（契约 v2.50 §3.3）。
 *
 * 起因是用户截图：他收到的「日报已完成」写着「点开可以看全文」，而手机上是 Telegram 的一条纯文本
 * ——**那里没有任何东西可以点**。根因不在文案作者，在方案：通道方案原来说「`deeplink` 随正文一起
 * 交给通道侧」，而通道侧只收 `text`。所以推出去的自足文本里不许出现指向**当前表面**的动作。
 *
 * 三条判据都按契约原文，且都在这里机械执行：
 * 1. **遍历目录里全部已批准事件**（平台 + 产品），不是手挑几条；条数也断言，覆盖缩水会红。
 * 2. **只挡「指代本条通知」的形态**：`点开`／`点一下`／`点这里`／`点击`／`点它`、
 *    `查看详情`／`打开详情`／`看全文`／`查看全文`／`打开全文`。
 *    **`打开`、`查看` 单独出现不算违规**——「去设置里打开代理再试」是读者真能做的去向指引，
 *    失败通知没有去路比多一句话更糟。英文同理：只挡句首祈使与 `open it/this/that`。
 * 3. **正面样本必须通过**：`BTC open interest dropped`（`open interest` 是「未平仓」这个领域名词）。
 *    没有这条，守卫第一次跑就红在最该保住的句子上，然后有人加白名单——那就回到「靠人记」。
 *
 * **为什么放在 `apps/desktop-shell/src`**：产品文案只有产品 manifest 里有，而平台不允许 import
 * 产品代码（契约 N1）。这里是**装配根那一侧**（`src/main.ts` 同样 import `@products/generated`），
 * 才可能一处覆盖两边——盖在 `platform/notifications` 里要么漏产品，要么违反边界。
 */
import { describe, expect, it } from 'vitest'

import { productManifests } from '@products/generated/productManifests'
import { notificationCopy } from '@platform/i18n/notificationCopy'
import { formatPushText } from '@platform/notifications/delivery/channelPushPort'
import { createNotificationCopyPort } from '@platform/notifications/contracts/notificationCopyPort'
import { findActionDirective } from '@platform/notifications/contracts/actionDirective'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import type { NotificationCopyRef } from '@platform/notifications/contracts/notificationCopyPort'
import type { NotificationEventDeclaration } from '@platform/notifications/contracts/notificationEventCatalog'
import { productNotificationCopyTables } from '@platform/desktop/main/composition/notificationCopyTables'

type Scanned = { id: string; key: string; language: 'zh-CN' | 'en-US'; text: string }

function declarationsById(): Map<string, NotificationEventDeclaration> {
  const byId = new Map<string, NotificationEventDeclaration>()
  for (const declaration of PLATFORM_NOTIFICATION_EVENTS) byId.set(declaration.id, declaration)
  for (const manifest of productManifests) {
    for (const declaration of manifest.notificationEvents ?? []) byId.set(declaration.id, declaration)
  }
  return byId
}

/** 一条声明里所有会被推出去的句子键（标题、正文及其变体、理由）；动作标签键不在此列。 */
function copyKeysOf(declaration: NotificationEventDeclaration): string[] {
  return [
    declaration.titleKey,
    ...(declaration.bodyKey === undefined ? [] : [declaration.bodyKey]),
    ...Object.values(declaration.bodyKeyByVariant ?? {}),
    declaration.reasonKey
  ]
}

function refFor(id: string, key: string): NotificationCopyRef {
  return id.startsWith('platform.')
    ? { scope: 'platform', key }
    : { scope: 'product', productId: id.split('.')[0] ?? '', key }
}

describe('手机推送不带动作指令（契约 v2.50）', () => {
  const port = createNotificationCopyPort({
    platform: notificationCopy,
    products: productNotificationCopyTables(productManifests)
  })
  const byId = declarationsById()
  const approvedIds = Object.keys(NOTIFICATION_EVENT_POLICY)

  it('每一条已批准事件都有声明可查（没有声明就没法扫，等于漏掉）', () => {
    const missing = approvedIds.filter((id) => !byId.has(id))
    expect(missing).toEqual([])
  })

  it('全部事件的标题／正文（含变体）／理由，中英都不含动作指令', () => {
    const scanned: Scanned[] = []
    for (const id of approvedIds) {
      const declaration = byId.get(id)
      if (declaration === undefined) continue
      for (const key of copyKeysOf(declaration)) {
        for (const language of ['zh-CN', 'en-US'] as const) {
          const text = port.resolve(refFor(id, key), language) ?? ''
          scanned.push({ id, key, language, text })
        }
      }
    }

    // 覆盖条数也要断言：有人把循环改窄、或某条声明被删掉，这里会先红。
    expect(new Set(scanned.map((entry) => entry.id)).size).toBeGreaterThanOrEqual(approvedIds.length)

    const offenders = scanned.filter((entry) => findActionDirective(entry.text) !== null)
    expect(offenders.map((entry) => `${entry.id} ${entry.key} ${entry.language}: ${entry.text}`)).toEqual([])
  })

  it('第一层管「表里干净」，第二层管「拼起来也干净」：formatPushText 输出同样不许有动作指令', () => {
    const lines: string[] = []
    for (const id of approvedIds) {
      const declaration = byId.get(id)
      if (declaration === undefined) continue
      for (const language of ['zh-CN', 'en-US'] as const) {
        const bodyKey = declaration.bodyKey === undefined
          ? undefined
          : declaration.bodyKey
        lines.push(formatPushText({
          title: port.resolve(refFor(id, declaration.titleKey), language) ?? '',
          body: bodyKey === undefined ? '' : (port.resolve(refFor(id, bodyKey), language) ?? ''),
          reason: port.resolve(refFor(id, declaration.reasonKey), language) ?? '',
          actionLabels: {}
        }))
      }
    }
    const offenders = lines.filter((text) => findActionDirective(text) !== null)
    expect(offenders).toEqual([])
  })

  it('兜底句也在手机上出现，同样不许承诺点开', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const text = notificationCopy[language]['notification.fallback.title']
      expect(findActionDirective(text)).toBeNull()
    }
  })

  it('正面样本：领域名词与去向指引都不算动作指令（不许靠白名单解决误报）', () => {
    // `open interest` 是「未平仓」：这是最该保住的一条信号标题，绝不能判成动作。
    const noun = formatPushText({
      title: 'BTC open interest dropped',
      body: '15-minute drop 2.3% (threshold 1.5%), volume 3.1x.',
      reason: 'The rule matched and reached the severity threshold you set.',
      actionLabels: {}
    })
    expect(findActionDirective(noun)).toBeNull()

    // 去向指引：告诉读者**在应用里**去哪修，是他在手机上真能做的事。
    const directions = [
      '密钥失效了。去设置里重新填一把就能继续。',
      'The key is no longer accepted. Open settings and save a new one.'
    ]
    for (const text of directions) expect(findActionDirective(text)).toBeNull()
  })
})
