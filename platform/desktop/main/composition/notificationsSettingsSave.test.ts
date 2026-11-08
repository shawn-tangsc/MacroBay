import { describe, expect, it } from 'vitest'

import { withSurfaceSaveDiagnostics } from './notifications'

/**
 * 表面选择写失败必须留一行痕（契约 §5.5）。
 *
 * 这一格以前是**静默**的：勾弹回去、一个字不说，读者看到的就是「点了没反应」。
 * 日志只许打**组键与原因**——`surfaceSelections` 是读者自己的配置，整份抄进日志就是第二个问题。
 */
describe('surface selection save diagnostics', () => {
  it('logs the group key and the reason, and rethrows so the page can say it failed', async () => {
    const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = []
    const save = withSurfaceSaveDiagnostics({
      update: async () => {
        throw new Error('disk-full')
      },
      log: (level, event, fields) => logs.push({ level, event, ...(fields === undefined ? {} : { fields }) })
    })

    await expect(save({ surfaceSelections: { 'calendar-events': { channel: true, toast: true } } }))
      .rejects.toThrow('disk-full')
    expect(logs).toEqual([
      { level: 'warn', event: 'notification.surface-selection-save-failed', fields: { key: 'calendar-events', reason: 'disk-full' } }
    ])
    // 不许把读者的整份选择抄进日志。
    expect(JSON.stringify(logs)).not.toContain('toast')
  })

  it('stays silent for other settings — that event name means this one thing', async () => {
    const logs: unknown[] = []
    const save = withSurfaceSaveDiagnostics({
      update: async () => {
        throw new Error('disk-full')
      },
      log: (_level, event) => logs.push(event)
    })
    await expect(save({ toastEnabled: true })).rejects.toThrow('disk-full')
    expect(logs).toEqual([])
  })
})
