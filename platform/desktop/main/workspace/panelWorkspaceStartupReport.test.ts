import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceStartReport } from './composePanelWorkspace'
import {
  formatPanelWorkspaceDisposeSummary,
  formatPanelWorkspaceFlushSummary,
  reportPanelWorkspaceDispose,
  reportPanelWorkspaceFlush,
  reportPanelWorkspaceStart,
  sanitizePanelInstanceKey
} from './panelWorkspaceStartupReport'

/**
 * Owner: platform/desktop/main/workspace / P1-06h（N4）。回归：本文件。
 *
 * 真机症状（P1-07 记录项 N4）：`composePanelWorkspace.start()` 的返回值（restore / downgradedDetached 的
 * `restore-invalid` 明细 / registrationFailures / mayOverwrite / restoredPanels）被 app.ts 丢弃，
 * 恢复降级原因在运行期完全不可观测。本文件注入 log spy 固定「这些字段必须被记录」，
 * 并顺带固定「日志只含状态/计数/opaque id/枚举词，绝不含路径或密钥」。
 */
function readyReport(overrides: Partial<WorkspaceStartReport> = {}): WorkspaceStartReport {
  return {
    status: 'ready',
    restore: 'restored',
    restoredPanels: 3,
    downgradedDetached: [{
      panelInstanceKey: 'panel_00000000-0000-4000-8000-000000000001',
      from: 'detached',
      to: 'docked-right',
      reason: 'restore-invalid'
    }],
    registrationFailures: 2,
    mayOverwrite: true,
    ...overrides
  }
}

describe('reportPanelWorkspaceStart：启动报告必须落平台日志（N4）', () => {
  it('记录 restore / restoredPanels / registrationFailures / mayOverwrite 与降级条数', () => {
    const log = vi.fn()
    reportPanelWorkspaceStart({ report: readyReport(), log })

    expect(log).toHaveBeenCalled()
    const text = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(text).toContain('restore=restored')
    expect(text).toContain('restoredPanels=3')
    expect(text).toContain('registrationFailures=2')
    expect(text).toContain('mayOverwrite=true')
    expect(text).toContain('downgradedDetached=1')
    expect(text).toContain('status=ready')
  })

  it('逐条记录降级明细：panelInstanceKey、from→to 与原因词 restore-invalid', () => {
    const log = vi.fn()
    const report = readyReport()
    reportPanelWorkspaceStart({ report, log })

    const lines = log.mock.calls.map((call) => String(call[0]))
    const detail = lines.find((line) => line.includes(report.downgradedDetached[0]!.panelInstanceKey))
    expect(detail).toBeDefined()
    expect(detail).toContain('detached')
    expect(detail).toContain('docked-right')
    expect(detail).toContain('restore-invalid')
  })

  it('多面板降级时逐条记录，绝不合并成一行计数', () => {
    const log = vi.fn()
    const report = readyReport({
      downgradedDetached: [
        { panelInstanceKey: 'panel_a', from: 'detached', to: 'docked-right', reason: 'restore-invalid' },
        { panelInstanceKey: 'panel_b', from: 'detached', to: 'embedded', reason: 'restore-invalid' }
      ]
    })
    reportPanelWorkspaceStart({ report, log })

    const lines = log.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.includes('panel_a'))).toHaveLength(1)
    expect(lines.filter((line) => line.includes('panel_b'))).toHaveLength(1)
    expect(lines.find((line) => line.includes('panel_a'))).toContain('docked-right')
    expect(lines.find((line) => line.includes('panel_b'))).toContain('embedded')
  })

  it('禁用态（no-pages）也不丢字段：status/reason/restore 与计数照样记录，且没有降级明细行', () => {
    const log = vi.fn()
    reportPanelWorkspaceStart({
      report: {
        status: 'disabled', reason: 'no-pages', restore: 'disabled', restoredPanels: 0,
        downgradedDetached: [], registrationFailures: 1, mayOverwrite: false
      },
      log
    })

    const lines = log.mock.calls.map((call) => String(call[0]))
    const summary = lines[0] ?? ''
    expect(summary).toContain('status=disabled')
    expect(summary).toContain('reason=no-pages')
    expect(summary).toContain('restore=disabled')
    expect(summary).toContain('restoredPanels=0')
    expect(summary).toContain('registrationFailures=1')
    expect(summary).toContain('mayOverwrite=false')
    expect(summary).toContain('downgradedDetached=0')
    expect(lines).toHaveLength(1) // 没有降级 ⇒ 没有明细行，但摘要字段一个都不少
  })

  it('无降级的 ready 报告同样只输出摘要行，且不含任何路径/URL 分隔符', () => {
    const log = vi.fn()
    reportPanelWorkspaceStart({ report: readyReport({ downgradedDetached: [] }), log })

    const text = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(text).toContain('downgradedDetached=0')
    expect(text).not.toMatch(/[\\/]/) // 任何文件路径/URL 都会带分隔符：启动日志不得泄露
  })
})

/**
 * P1-06i（B）：降级明细的 id 净化。
 * 真机症状（P1-06h 独立审查）：审查线把 `/Users/example/private/secret.json` 塞进 `panelInstanceKey`
 * 会被逐字打印。这个字段来自磁盘上的布局文档，而上游只校验「非空、≤200、无控制字符」，因此日志必须
 * 自己净化：只有严格 opaque 形态才原样打印，其余一律 `<redacted>`；摘要计数不受影响。
 */
describe('P1-06i（B）：降级明细的 panelInstanceKey 必须净化', () => {
  function downgradesFor(ids: readonly string[]): WorkspaceStartReport['downgradedDetached'] {
    return ids.map((panelInstanceKey) => ({ panelInstanceKey, from: 'detached', to: 'docked-right', reason: 'restore-invalid' }))
  }

  it('路径型/URL 型/超长 id 一律替换为 <redacted>，日志不得出现分隔符、家目录或密钥字样', () => {
    const hostileIds = [
      '/Users/example/private/secret.json',
      'file:///Users/example/.ssh/id_rsa',
      'https://example.com/v1/models?token=sk-live-abcdef',
      'C:\\Users\\example\\AppData\\secret.key',
      'panel_/Users/example/private/secret.json',
      `panel_${'a'.repeat(400)}`
    ]
    const log = vi.fn()
    reportPanelWorkspaceStart({ report: readyReport({ downgradedDetached: downgradesFor(hostileIds) }), log })

    const text = log.mock.calls.map((call) => String(call[0])).join('\n')
    // 摘要计数不受净化影响：条数照样如实记录
    expect(text).toContain(`downgradedDetached=${hostileIds.length}`)
    expect(text.match(/<redacted>/gu)).toHaveLength(hostileIds.length)
    expect(text).not.toMatch(/[\\/]/u)
    expect(text).not.toContain('http')
    expect(text).not.toContain('file:')
    expect(text).not.toContain('example')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('token')
    for (const id of hostileIds) expect(text).not.toContain(id)
  })

  it('合法 opaque id（裸 uuid / 既有前缀 + 受限字符集）仍原样可读，运维可定位', () => {
    const opaqueIds = [
      'panel_00000000-0000-4000-8000-000000000001',
      'workspace_1a2b3c4d',
      '9f1d7c2a-3b4e-4c5d-8e9f-0a1b2c3d4e5f'
    ]
    const log = vi.fn()
    reportPanelWorkspaceStart({ report: readyReport({ downgradedDetached: downgradesFor(opaqueIds) }), log })

    const lines = log.mock.calls.map((call) => String(call[0]))
    for (const id of opaqueIds) expect(lines.filter((line) => line.includes(id))).toHaveLength(1)
    expect(lines.join('\n')).not.toContain('<redacted>')
  })

  it('混排时逐条判定：合法 id 原样、非法 id 净化，且每条降级仍单独成行', () => {
    const log = vi.fn()
    reportPanelWorkspaceStart({
      report: readyReport({
        downgradedDetached: downgradesFor(['panel_00000000-0000-4000-8000-000000000002', '/etc/passwd'])
      }),
      log
    })

    const lines = log.mock.calls.map((call) => String(call[0]))
    const detail = lines.filter((line) => line.includes('restore-downgraded'))
    expect(detail).toHaveLength(2)
    expect(detail.filter((line) => line.includes('panel_00000000-0000-4000-8000-000000000002'))).toHaveLength(1)
    expect(detail.filter((line) => line.includes('<redacted>'))).toHaveLength(1)
    expect(lines.join('\n')).not.toContain('passwd')
  })

  it('sanitizePanelInstanceKey：只放行严格 opaque 形态（前缀 + 受限字符集与长度 / 裸 uuid）', () => {
    for (const accepted of ['panel_a', 'window_1a2b3c4d', 'workspace_x-9', '0f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f']) {
      expect(sanitizePanelInstanceKey(accepted)).toBe(accepted)
    }
    for (const rejected of ['', 'panel_', 'panel_a/b', 'panel_a\\b', 'panel_a.b', 'panel_a:b', 'other_a',
      `panel_${'a'.repeat(129)}`, '/Users/example/secret.json', 'https://example.com/?token=x']) {
      expect(sanitizePanelInstanceKey(rejected)).toBe('<redacted>')
    }
  })
})

describe('app.ts 接线护栏（受保护 seam）：启动报告必须真的被记日志', () => {
  const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')

  it('compose 之后调用 reportPanelWorkspaceStart({ report: await panelWorkspace.start() })', () => {
    expect(appSource).toContain('reportPanelWorkspaceStart({ report: await panelWorkspace.start() })')
    // 返回值绝不能被丢弃（丢弃即恢复降级原因运行期不可观测）
    expect(appSource).not.toMatch(/^\s*await panelWorkspace\.start\(\)\s*$/mu)
  })
})

/**
 * P1-06m：退出 flush / dispose 结果必须可观测。
 * 真机症状（P1-07R）：`app.ts` 丢弃 `dispose()` 的返回值 ⇒ 无法区分「flush 未跑」与「flush 跑输」；
 * debounce（真机实测 261ms）窗口内的最后一次布局变更在退出时丢失，日志里没有任何痕迹。
 */
describe('P1-06m 退出 flush / dispose 报告：字段齐全、可注入 log、绝不泄露路径', () => {
  /** 退出报告只允许出现状态、计数、枚举词与 revision 数字。 */
  const expectNoLeak = (text: string): void => {
    expect(text).not.toMatch(/[\\/]/u)
    expect(text).not.toMatch(/https?:|file:|\.json|secret|token|api[-_]?key/iu)
  }

  it('flush 摘要一个字段都不省：status/outcome/hadPendingWrites/layoutRevision', () => {
    const summary = formatPanelWorkspaceFlushSummary({
      status: 'ready', outcome: 'saved', hadPendingWrites: true, layoutRevision: 12
    })
    expect(summary).toContain('status=ready')
    expect(summary).toContain('outcome=saved')
    expect(summary).toContain('hadPendingWrites=true')
    expect(summary).toContain('layoutRevision=12')
    expectNoLeak(summary)
  })

  it('timeout / 无待写 / 禁用态如实记录，绝不用 skipped 冒充成功', () => {
    expect(formatPanelWorkspaceFlushSummary({
      status: 'ready', outcome: 'timeout', hadPendingWrites: true, layoutRevision: 3
    })).toContain('outcome=timeout')
    expect(formatPanelWorkspaceFlushSummary({
      status: 'ready', outcome: 'failed', hadPendingWrites: true, layoutRevision: 3
    })).toContain('outcome=failed')
    const skipped = formatPanelWorkspaceFlushSummary({
      status: 'ready', outcome: 'skipped', hadPendingWrites: false, layoutRevision: 3
    })
    expect(skipped).toContain('outcome=skipped')
    expect(skipped).toContain('hadPendingWrites=false')
    const disabled = formatPanelWorkspaceFlushSummary({
      status: 'disabled', outcome: 'skipped', hadPendingWrites: false, layoutRevision: 0
    })
    expect(disabled).toContain('status=disabled')
    expectNoLeak(disabled)
  })

  it('reportPanelWorkspaceFlush 注入 log 恰好一行（缺省写平台标准输出）', () => {
    const log = vi.fn()
    reportPanelWorkspaceFlush({
      report: { status: 'ready', outcome: 'saved', hadPendingWrites: true, layoutRevision: 5 }, log
    })
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).toContain('outcome=saved')
  })

  it('dispose 摘要字段齐全：flushOutcome/hadPendingWrites/destroyedWindows/ownersRevoked', () => {
    const summary = formatPanelWorkspaceDisposeSummary({
      status: 'ready', flushOutcome: 'timeout', hadPendingWrites: true, layoutRevision: 9,
      destroyedWindows: 3, ownersRevoked: 2
    })
    expect(summary).toContain('status=ready')
    expect(summary).toContain('flushOutcome=timeout')
    expect(summary).toContain('hadPendingWrites=true')
    expect(summary).toContain('layoutRevision=9')
    expect(summary).toContain('destroyedWindows=3')
    expect(summary).toContain('ownersRevoked=2')
    expectNoLeak(summary)
  })

  it('reportPanelWorkspaceDispose：禁用态（缺省字段）也照实记录 0/false，形状绝不发散', () => {
    const log = vi.fn()
    reportPanelWorkspaceDispose({ report: { status: 'disabled', flushOutcome: 'skipped' }, log })
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(line).toContain('status=disabled')
    expect(line).toContain('flushOutcome=skipped')
    expect(line).toContain('hadPendingWrites=false')
    expect(line).toContain('destroyedWindows=0')
    expect(line).toContain('ownersRevoked=0')
    expectNoLeak(line)
  })

  it('app.ts 接线护栏：退出 flush 与 dispose 结果都必须真的落日志（绝不丢弃返回值）', () => {
    const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')
    expect(appSource).toContain('reportPanelWorkspaceFlush({ report: await panelWorkspaceForDisposal.flushLayout() })')
    expect(appSource).toContain('reportPanelWorkspaceDispose({ report:')
    expect(appSource).not.toMatch(/^\s*await panelWorkspaceForDisposal\?\.dispose\(\)\s*$/mu)
  })
})
