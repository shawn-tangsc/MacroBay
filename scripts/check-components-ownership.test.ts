import { describe, expect, it } from 'vitest'

import {
  COMPONENTS_DIR,
  declaresComponentOwner,
  findViolations,
  touchesComponents
} from './check-components-ownership.mts'

describe('components ownership guard', () => {
  it('treats only the components directory as owned, not look-alike prefixes', () => {
    expect(touchesComponents([`${COMPONENTS_DIR}/menu/ContextMenu.tsx`])).toBe(true)
    expect(touchesComponents([COMPONENTS_DIR])).toBe(true)
    // 前缀相同但不是这个目录：`components-old`、`components.md` 都不算。
    expect(touchesComponents([`${COMPONENTS_DIR}-old/legacy.tsx`])).toBe(false)
    expect(touchesComponents([`${COMPONENTS_DIR}.md`])).toBe(false)
    expect(touchesComponents(['platform/ui/theme/windowTheme.ts'])).toBe(false)
  })

  it('accepts the trailer only with the owner value', () => {
    expect(declaresComponentOwner('fix(ui): x\n\nComponent-Owner: 前端组件\n')).toBe(true)
    expect(declaresComponentOwner('fix(ui): x\n\nComponent-Owner: 其他线\n')).toBe(false)
    expect(declaresComponentOwner('fix(ui): mention Component-Owner in prose\n')).toBe(false)
    expect(declaresComponentOwner('fix(ui): x')).toBe(false)
  })

  it('flags a commit that edits components without the trailer', () => {
    const violations = findViolations([
      {
        hash: 'aaa',
        subject: 'feat(ui): touch the component',
        message: 'feat(ui): touch the component',
        authorDate: '2026-11-02T14:00:00+08:00',
        files: [`${COMPONENTS_DIR}/status-pill/StatusPill.tsx`]
      }
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0].files).toEqual([`${COMPONENTS_DIR}/status-pill/StatusPill.tsx`])
  })

  it('passes the owner line, and passes everyone who left the directory alone', () => {
    const violations = findViolations([
      {
        hash: 'bbb',
        subject: 'fix(ui): owner change',
        message: 'fix(ui): owner change\n\nComponent-Owner: 前端组件',
        authorDate: '2026-11-02T14:00:00+08:00',
        files: [`${COMPONENTS_DIR}/menu/ContextMenu.tsx`]
      },
      {
        hash: 'ccc',
        subject: 'feat(notifications): unrelated',
        message: 'feat(notifications): unrelated',
        authorDate: '2026-11-02T14:00:00+08:00',
        files: ['platform/notifications/runtime/notificationRuntime.ts']
      }
    ])
    expect(violations).toEqual([])
  })
  it('flags a component commit that carries another line\'s files without an Also line', () => {
    // 真实样本：取自真实提交 `27c8221`（220 行频道线业务迁移混进组件提交）。
    // 那条提交在生效点之前，所以门禁不再判它——**样本退场，但夹具常驻**；
    // 否则半年后有人看它是「合成样本」就顺手删掉，守卫就只剩自己造的证据。
    const violations = findViolations([
      {
        hash: 'bbb',
        subject: 'feat(state): x',
        message: 'feat(state): x\n\nComponent-Owner: 前端组件\n',
        authorDate: '2026-11-02T14:00:00+08:00',
        files: [
          `${COMPONENTS_DIR}/state/StateView.tsx`,
          'platform/desktop/main/channels/channelMaintenanceJobs.ts',
          'platform/desktop/main/channels/channelMaintenanceJobs.test.ts'
        ]
      }
    ])

    expect(violations).toHaveLength(1)
    expect(violations[0].unexplained).toEqual([
      'platform/desktop/main/channels/channelMaintenanceJobs.ts',
      'platform/desktop/main/channels/channelMaintenanceJobs.test.ts'
    ])
  })

  it('passes when every outside file is named on an Also line', () => {
    const violations = findViolations([
      {
        hash: 'ccc',
        subject: 'feat(ui): x',
        message: [
          'feat(ui): x',
          '',
          'Component-Owner: 前端组件',
          'Also: platform/contracts/queryOutcome.ts — 白名单是契约，组件读它',
          'Also: docs/development/ui-state-components.md — 公开文档的码表'
        ].join('\n'),
        authorDate: '2026-11-02T14:00:00+08:00',
        files: [
          `${COMPONENTS_DIR}/state/StateView.tsx`,
          'platform/contracts/queryOutcome.ts',
          'docs/development/ui-state-components.md'
        ]
      }
    ])

    expect(violations).toEqual([])
  })

  it('does not judge commits older than the Also rule, and never asks for a reason on the component\'s own doc', () => {
    // 判定顺序：`Also:` 只判生效点之后的提交；组件自己的公开文档本来就在允许集合里。
    const commits = [
      {
        hash: 'old',
        subject: 'feat(state): before the rule',
        authorDate: '2026-11-02T13:00:00+08:00',
        message: 'feat(state): before the rule\n\nComponent-Owner: 前端组件\n',
        files: [`${COMPONENTS_DIR}/state/StateView.tsx`, 'platform/contracts/queryOutcome.ts']
      },
      {
        hash: 'new',
        subject: 'feat(state): doc follows the component',
        message: 'feat(state): doc follows the component\n\nComponent-Owner: 前端组件\n',
        authorDate: '2026-11-02T14:00:00+08:00',
        files: [
          `${COMPONENTS_DIR}/state/StateView.tsx`,
          'docs/development/ui-state-components.md',
          'docs/development/ui-state-components.zh-CN.md'
        ]
      }
    ]

    expect(findViolations(commits, new Set(['old']))).toEqual([])

    // 反过来：同一笔若带上契约文件却不肯写理由，就必须红（文档豁免不等于全豁免）。
    const withContract = [
      { ...commits[1], files: [...commits[1].files, 'platform/contracts/queryOutcome.ts'] }
    ]
    expect(findViolations(withContract)).toHaveLength(1)
  })

  it('judges by author date, so a rebase cannot silently retire the cutover', () => {
    // 同一条提交形状，只差作者日期：早于生效点 → 放行；晚于生效点 → 红。
    // 判据用日期而不是哈希，因为 rebase 换哈希、不换作者日期（今晚因此静默失效过一次）。
    const shape = (authorDate: string) => [
      {
        hash: 'x',
        subject: 'feat(ui): touches components without a declaration',
        authorDate,
        message: 'feat(ui): touches components without a declaration',
        files: [`${COMPONENTS_DIR}/state/StateView.tsx`, 'platform/contracts/queryOutcome.ts']
      }
    ]

    expect(findViolations(shape('2026-11-02T13:00:00+08:00'))).toEqual([])
    expect(findViolations(shape('2026-11-02T14:00:00+08:00'))).toHaveLength(1)
    // 读不出日期时从严判：兜底不许静默放行。
    expect(findViolations(shape('not-a-date'))).toHaveLength(1)
  })

  describe('later claim (one-off backfill)', () => {
    const untagged = {
      hash: 'd1d1d1d',
      subject: 'test(ui): relax the key-shape guard',
      message: 'test(ui): relax the key-shape guard',
      authorDate: '2026-11-02T14:00:00+08:00',
      files: [`${COMPONENTS_DIR}/tooltip/tooltipCallSiteGuard.test.ts`, `${COMPONENTS_DIR}/textKeyShape.ts`]
    }
    const claim = (extra: readonly string[] = [], files: readonly string[] = ['scripts/check-components-ownership.mts']) => ({
      hash: 'c1c1c1c',
      subject: 'chore(ui): claim the guard commit',
      message: ['chore(ui): claim the guard commit', '', 'Component-Owner: 前端组件', 'Owns: d1d1d1d', ...extra].join('\n'),
      authorDate: '2026-11-02T14:05:00+08:00',
      files
    })

    it('rescues an untagged component commit, and only when the claim exists', () => {
      // 反向实测：拿掉认领，原来红的那笔必须重新红。
      expect(findViolations([untagged])).toHaveLength(1)
      expect(findViolations([untagged, claim()])).toEqual([])
    })

    it('validates the content, not just the declaration', () => {
      // 认领方要为一个不在自己领域里的路径负责：不写 `Also:` 就不认。
      const withForeignPath = { ...untagged, files: [...untagged.files, 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'] }
      const withoutReason = claim()
      withoutReason.files = ['scripts/check-components-ownership.mts']
      expect(findViolations([withForeignPath, withoutReason])).toHaveLength(1)

      const withReason = claim(['Also: apps/desktop-shell/src/renderer/src/shell/AppShell.tsx — 调用点必须与组件同笔'])
      expect(findViolations([withForeignPath, withReason])).toEqual([])
    })

    it('never lets one commit carry two owners', () => {
      const alreadyTagged = { ...untagged, message: 'test(ui): x\n\nComponent-Owner: 其他线' }
      expect(findViolations([alreadyTagged, claim()])).toHaveLength(1)
    })

    it('only claims commits that are not on a remote', () => {
      expect(findViolations([untagged, claim()], { isPushed: (hash) => hash === 'd1d1d1d' })).toHaveLength(1)
    })
  })
})
