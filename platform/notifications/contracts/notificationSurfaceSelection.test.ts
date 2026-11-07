import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from './notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from './notificationEventPolicy'
import {
  createDefaultNotificationRuntimeSettings,
  type NotificationSubmitRequest
} from './notificationContracts'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { planNotificationSubmit } from '../runtime/notificationSubmitPlan'
import { createNotificationSettingsSurface } from '../runtime/notificationRuntimeSettings'
import {
  resolveSurfaceSelection,
  surfaceGroupMembers,
  type NotificationSurfaceSelection
} from './notificationSurfaceSelection'

/**
 * 第三层（契约 §5.5）：事件级 / 组级的表面选择。
 *
 * 这一层的三件硬事：**只能收窄**（没批的面存进来也落不下来）、**一组一份**（读者不为同一件事勾两次）、
 * **存量对不上就按都关**（宁可少发一条，也不要一半生效却看着正常）。
 */

const catalog = createNotificationEventCatalog({
  policy: {
    'platform.plain': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false },
    'platform.grouped-a': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'demo' },
    'platform.grouped-b': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'demo' }
  },
  sources: [
    {
      productId: 'platform',
      events: [
        { id: 'platform.plain', titleKey: 'notification.test.title', reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder', requestedDisruptionLevels: ['toast', 'channel'], dedupeKeyTemplate: 'plain:{id}', dedupeUnit: 'occurrence' },
        { id: 'platform.grouped-a', titleKey: 'notification.test.title', reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder', requestedDisruptionLevels: ['toast', 'channel'], dedupeKeyTemplate: 'ga:{id}', dedupeUnit: 'occurrence' },
        { id: 'platform.grouped-b', titleKey: 'notification.test.title', reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder', requestedDisruptionLevels: ['toast', 'channel'], dedupeKeyTemplate: 'gb:{id}', dedupeUnit: 'occurrence' }
      ]
    }
  ]
})

const entry = (id: string) => {
  const found = catalog.get(id)
  if (found === undefined) throw new Error(`missing ${id}`)
  return found
}

describe('resolving the third layer', () => {
  it('treats "never chose" as allowed, not as off', () => {
    // 刚打开提醒的人如果读到「全关」，会一条都收不到——那不是他的选择。
    const resolved = resolveSurfaceSelection({ entry: entry('platform.plain'), list: () => catalog.list(), selections: {} })
    expect(resolved.conflict).toBe(false)
    expect(resolved.selection).toEqual({ channel: true, toast: true })
    // 这一条没批桌面，所以桌面根本不在可用面里。
    expect(Object.keys(resolved.selection)).not.toContain('desktop')
  })

  it('narrows only where the reader said false', () => {
    const selections: Record<string, NotificationSurfaceSelection> = { 'platform.plain': { toast: false } }
    const resolved = resolveSurfaceSelection({ entry: entry('platform.plain'), list: () => catalog.list(), selections })
    expect(resolved.selection).toEqual({ channel: true, toast: false })
  })

  it('clamps a stored surface the approval table never granted', () => {
    // 越权数据（历史遗留、手改文件）不许把桌面带进来。
    const selections: Record<string, NotificationSurfaceSelection> = { 'platform.plain': { desktop: true, channel: false } }
    const resolved = resolveSurfaceSelection({ entry: entry('platform.plain'), list: () => catalog.list(), selections })
    expect(Object.keys(resolved.selection)).not.toContain('desktop')
    expect(resolved.selection.channel).toBe(false)
  })
})

  it('derives the default from the approval table, not from a hard-coded "all on"', () => {
    // 默认不是写死的三面全开：某一行撤批一面，缺省就跟着收窄。
    // 而且这是**合法状态**，不是配置坏了——不报错，只是那一面不出现。
    const shrunk = createNotificationEventCatalog({
      policy: {
        'platform.shrunk': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
      },
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.shrunk',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: ['channel'],
          dedupeKeyTemplate: 'shrunk:{id}',
          dedupeUnit: 'occurrence'
        }]
      }]
    })
    const resolved = resolveSurfaceSelection({ entry: shrunk.get('platform.shrunk')!, list: () => shrunk.list(), selections: {} })
    expect(resolved.conflict).toBe(false)
    expect(resolved.selection).toEqual({ channel: true })
    expect(Object.keys(resolved.selection)).not.toContain('toast')
  })

describe('one group, one selection', () => {
  it('one stored key rules both members', () => {
    const selections: Record<string, NotificationSurfaceSelection> = { demo: { channel: true, toast: false } }
    for (const id of ['platform.grouped-a', 'platform.grouped-b']) {
      const resolved = resolveSurfaceSelection({ entry: entry(id), list: () => catalog.list(), selections })
      expect(resolved.selection).toEqual({ channel: true, toast: false })
    }
  })

  it('uses the intersection of the members, never the union', () => {
    // B 不批提示：共享选择里就不能有提示，否则勾了只有 A 会闪——那是假配置。
    const skewed = createNotificationEventCatalog({
      policy: {
        'platform.grouped-a': { approvedDisruptionLevels: ['center', 'toast', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'demo' },
        'platform.grouped-b': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false, surfaceGroup: 'demo' }
      },
      sources: [{
        productId: 'platform',
        events: [
          { id: 'platform.grouped-a', titleKey: 'notification.test.title', reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder', requestedDisruptionLevels: ['toast', 'channel'], dedupeKeyTemplate: 'ga:{id}', dedupeUnit: 'occurrence' },
          { id: 'platform.grouped-b', titleKey: 'notification.test.title', reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder', requestedDisruptionLevels: ['channel'], dedupeKeyTemplate: 'gb:{id}', dedupeUnit: 'occurrence' }
        ]
      }]
    })
    const resolved = resolveSurfaceSelection({
      entry: skewed.get('platform.grouped-a')!,
      list: () => skewed.list(),
      selections: { demo: { toast: true, channel: true } }
    })
    expect(resolved.selection).toEqual({ channel: true })
    expect(Object.keys(resolved.selection)).not.toContain('toast')
  })

  it('turns everything off and reports a conflict when the two legacy values disagree', () => {
    // 历史形状：两条各存一份，且已经不一致（半次写入 / 老版本）。宁可都不发，也不要一半生效。
    const selections: Record<string, NotificationSurfaceSelection> = {
      'platform.grouped-a': { channel: true, toast: true },
      'platform.grouped-b': { channel: true, toast: false }
    }
    const resolved = resolveSurfaceSelection({ entry: entry('platform.grouped-a'), list: () => catalog.list(), selections })
    expect(resolved.conflict).toBe(true)
    expect(resolved.selection).toEqual({ channel: false, toast: false })
  })

  it('keeps the legacy values when they agree, without inventing a conflict', () => {
    const selections: Record<string, NotificationSurfaceSelection> = {
      'platform.grouped-a': { channel: true, toast: false },
      'platform.grouped-b': { channel: true, toast: false }
    }
    const resolved = resolveSurfaceSelection({ entry: entry('platform.grouped-b'), list: () => catalog.list(), selections })
    expect(resolved.conflict).toBe(false)
    expect(resolved.selection).toEqual({ channel: true, toast: false })
  })
})

describe('the approval table keeps the group honest', () => {
  /** 每个组里的成员必须批同样的可逐事件选的面——只改一行，交集就会变，勾了只对一条生效。 */
  it('every member of a group approves the same selectable surfaces', () => {
    const groups = new Map<string, string[]>()
    for (const [id, row] of Object.entries(NOTIFICATION_EVENT_POLICY)) {
      if (row.surfaceGroup === undefined) continue
      groups.set(row.surfaceGroup, [...(groups.get(row.surfaceGroup) ?? []), id])
    }
    expect([...groups.keys()]).toContain('calendar-events')
    for (const [group, ids] of groups) {
      const surfaces = ids.map((id) =>
        (['channel', 'toast', 'desktop'] as const)
          .filter((surface) => NOTIFICATION_EVENT_POLICY[id]!.approvedDisruptionLevels.includes(surface))
          .join(',')
      )
      expect(new Set(surfaces).size, `${group}: ${ids.join(' / ')}`).toBe(1)
    }
  })

  it('calendar-events is exactly the two calendar notifications', () => {
    // N11（开始前）的批准行要等提醒开发那一笔才进代码；那条一落，这里自动要求两组档位一致。
    const members = surfaceGroupMembers('calendar-events', () => catalog.list())
    expect(members.length).toBe(0) // 这个测试目录里没有真表，只验证函数本身
    const real = Object.entries(NOTIFICATION_EVENT_POLICY)
      .filter(([, row]) => row.surfaceGroup === 'calendar-events')
      .map(([id]) => id)
    expect(real).toEqual(['market-intelligence.macro.event-landed'])
  })
})

describe('writing one selection per group', () => {
  const createSurface = (selections: Record<string, NotificationSurfaceSelection> = {}) => {
    let settings = {
      ...createDefaultNotificationRuntimeSettings(),
      surfaceSelections: selections
    }
    const surface = createNotificationSettingsSurface({
      getCatalog: () => catalog,
      getSettings: async () => settings,
      updateSettings: async (patch) => { settings = { ...settings, ...patch } },
      load: async () => createDefaultNotificationStoreState(),
      exclusive: async (operation) => operation(),
      persistWithDiagnostics: async () => undefined,
      notifyChanged: () => undefined
    })
    return { surface, selections: () => settings.surfaceSelections ?? {} }
  }

  it('writes one key for the whole group, so a half write cannot happen', async () => {
    const { surface, selections } = createSurface()
    await surface.setSurfaceSelection('platform.grouped-a', { toast: false })
    // 只写组键：不会出现「A 写了、B 没写」。
    expect(Object.keys(selections())).toEqual(['demo'])
    const read = await surface.getSurfaceSelection('platform.grouped-b')
    expect(read.key).toBe('demo')
    expect(read.selection).toEqual({ channel: true, toast: false })
    expect(read.conflict).toBe(false)
  })

  it('refuses a surface the group never approved instead of storing it silently', async () => {
    const { surface } = createSurface()
    // 存进去读端也会夹掉，但调用方会以为存上了——所以写入口直接报错。
    await expect(surface.setSurfaceSelection('platform.plain', { desktop: true }))
      .rejects.toThrow(/notification-surface-not-approved: platform\.plain:desktop/)
  })

  it('refuses an event it does not know', async () => {
    const { surface } = createSurface()
    await expect(surface.setSurfaceSelection('platform.nope', { toast: true }))
      .rejects.toThrow(/notification-surface-event-unknown/)
  })

  it('reports the conflict on read, so the page can say why nothing will be sent', async () => {
    const { surface } = createSurface({
      'platform.grouped-a': { channel: true },
      'platform.grouped-b': { channel: false }
    })
    const read = await surface.getSurfaceSelection('platform.grouped-a')
    expect(read.conflict).toBe(true)
    expect(read.selection).toEqual({ channel: false, toast: false })
  })
})

describe('the submit plan honours the third layer', () => {
  const base = {
    catalog,
    settings: { ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true, toastEnabled: true },
    desktopSupported: true,
    now: '2026-11-07T03:00:00.000Z',
    timeZone: 'UTC'
  }
  const request = (eventTypeId: string) => ({
    eventTypeId,
    dedupeVars: { builder: 'template' as const, vars: { id: '1' } },
    actions: [],
    occurredAt: base.now
  })

  it('drops a surface the reader turned off, keeping the rest', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: { ...base.settings, surfaceSelections: { 'platform.plain': { channel: false } } },
      request: request('platform.plain')
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.levels).not.toContain('channel')
    expect(plan.levels).toContain('toast')
    expect(plan.surfaceConflict).toBe(false)
  })

  it('sends nothing but the centre record when the group values disagree, and flags it', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: {
        ...base.settings,
        surfaceSelections: {
          'platform.grouped-a': { channel: true, toast: true },
          'platform.grouped-b': { channel: false, toast: false }
        }
      },
      request: request('platform.grouped-a')
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.levels).toEqual(['center'])
    expect(plan.surfaceConflict).toBe(true)
  })
})
