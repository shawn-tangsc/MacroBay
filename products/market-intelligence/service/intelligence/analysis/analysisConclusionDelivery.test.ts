import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import { resolveDedupeKey } from '@platform/notifications/runtime/notificationSubmitValidation'
import { planNotificationSubmit } from '@platform/notifications/runtime/notificationSubmitPlan'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { buildAnalysisConclusionRequest } from './analysisConclusionPush'

/**
 * 「结论推送发不出去」这一层的真判据（2026-11-11 的真机缺陷）：
 *
 * 事件声明写的是 `analysis:{triggerKey}:{cutoff}`，构造器给的却是 `bucket`，于是展开后仍留着
 * `{triggerKey}` → `missing-dedupe-key` → **整条被拒**；手动与自动两条路都走这个构造器，所以
 * 两条一起哑掉。这里用**真实目录**（产品 manifest 的声明 + 批准表）跑一遍平台提交计划，
 * 而不是自造一个模板——自造模板会让这类「名字对不上」永远查不出来。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: marketIntelligenceProductManifest.id,
    events: marketIntelligenceProductManifest.notificationEvents ?? [],
    ...(marketIntelligenceProductManifest.notificationApproval === undefined
      ? {} : { approval: marketIntelligenceProductManifest.notificationApproval })
  }]
})

const entry = catalog.get(MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion)!
const settings = {
  desktopEnabled: true, toastEnabled: false, popupEnabled: false,
  push: { channelId: null }, retentionDays: 30, defaultSnoozeMinutes: 60
}

/** 手动发送那条：`manual:<事件组>` + `${截止时刻}:${点击时刻}`，两次点击是两条键。 */
function manualRequest(clickAt: string): NotificationSubmitRequest {
  const cutoff = '2026-11-11T05:00:00.000Z'
  return {
    eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion,
    ...buildAnalysisConclusionRequest({
      summary: '多头被清，价格跌到位后买盘回来了。',
      citedCount: 2,
      triggerKey: 'manual:mi-eg-1',
      cutoff: `${cutoff}:${clickAt}`,
      occurredAt: clickAt,
      centerOnly: false
    })
  }
}

/** 自动推送那条：真实触发键 + 快照的截止时刻。 */
function automaticRequest(triggerKey = 'signal.open-interest.oi-liquidation-proxy'): NotificationSubmitRequest {
  return {
    eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion,
    ...buildAnalysisConclusionRequest({
      summary: '多头被清，价格跌到位后买盘回来了。',
      citedCount: 2,
      triggerKey,
      cutoff: '2026-11-11T05:00:00.000Z',
      occurredAt: '2026-11-11T05:10:00.000Z',
      centerOnly: true
    })
  }
}

const plan = (request: NotificationSubmitRequest) => planNotificationSubmit({
  catalog, settings, desktopSupported: true, request,
  now: '2026-11-11T05:10:00.000Z', timeZone: 'Asia/Shanghai'
})

describe('a conclusion notification resolves a dedupe key', () => {
  it('accepts the manual send instead of rejecting it for a missing dedupe key', () => {
    // 改前：`{triggerKey}` 展不开 → `missing-dedupe-key` → 整条拒收。读者点「发送到手机」什么都不发生。
    const outcome = plan(manualRequest('2026-11-11T05:10:00.000Z'))
    expect(outcome).toMatchObject({ kind: 'new' })
  })

  it('accepts the automatic push the same way', () => {
    expect(plan(automaticRequest())).toMatchObject({ kind: 'new' })
  })

  it('keeps the key composition: same trigger key and cutoff are one key, another cutoff is another', () => {
    const vars = manualRequest('2026-11-11T05:10:00.000Z').dedupeVars
    const key = resolveDedupeKey(entry, vars)
    expect(key).toBe('analysis:manual:mi-eg-1:2026-11-11T05:00:00.000Z:2026-11-11T05:10:00.000Z')

    const sameCutoff = manualRequest('2026-11-11T05:10:00.000Z').dedupeVars
    expect(resolveDedupeKey(entry, sameCutoff)).toBe(key)

    // 另一份快照（截止时刻不同）就是另一条：不能因为触发键相同就把两天的结论并成一条。
    const otherCutoff: NotificationSubmitRequest = {
      ...automaticRequest(),
      dedupeVars: { builder: 'template', vars: { triggerKey: 'signal.open-interest.oi-liquidation-proxy', cutoff: '2026-11-12T05:00:00.000Z' } }
    }
    expect(resolveDedupeKey(entry, otherCutoff.dedupeVars)).not.toBe(key)
  })

  it('gives two clicks two keys, so a manual send is never collapsed into the previous one', () => {
    const first = resolveDedupeKey(entry, manualRequest('2026-11-11T05:10:00.000Z').dedupeVars)
    const second = resolveDedupeKey(entry, manualRequest('2026-11-11T05:20:00.000Z').dedupeVars)
    expect(first).not.toBe(second)
  })
})
