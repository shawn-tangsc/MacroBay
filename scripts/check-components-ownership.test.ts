import { describe, expect, it } from 'vitest'

import {
  COMPONENTS_DIR,
  RULES_SINCE,
  declaresComponentOwner,
  findViolations,
  touchesComponents
} from './check-components-ownership.mts'

/**
 * 用例里的时刻**从 `RULES_SINCE` 推导，不写死**。
 *
 * 写死过一次的代价：生效点后移之后，所有「规则之后」的样本落到了豁免侧，9 条用例一起红——
 * 而红的原因不是规则错了，是**样本比规则旧**。凡是「从某一刻起生效」的规则，它的用例必须跟着
 * 生效点一起动，否则每次后移都要去改一遍测试，而改测试的人会顺手把判据也改松。
 */
const shift = (minutes: number): string => new Date(Date.parse(RULES_SINCE) + minutes * 60_000).toISOString()
/** 生效点之前：不判新规则。 */
const BEFORE = shift(-60)
/** 生效点之后：照常严判。 */
const AFTER = shift(60)
/** 比 AFTER 更晚，用于「认领那笔」与被认领那笔的先后。 */
const LATER = shift(120)

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
        authorDate: AFTER,
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
        authorDate: AFTER,
        files: [`${COMPONENTS_DIR}/menu/ContextMenu.tsx`]
      },
      {
        hash: 'ccc',
        subject: 'feat(notifications): unrelated',
        message: 'feat(notifications): unrelated',
        authorDate: AFTER,
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
        authorDate: AFTER,
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
        authorDate: AFTER,
        files: [
          `${COMPONENTS_DIR}/state/StateView.tsx`,
          'platform/contracts/queryOutcome.ts',
          'docs/development/ui-state-components.md'
        ]
      }
    ])

    expect(violations).toEqual([])
  })

  it('treats the migration debt lists as the component line\'s own account', () => {
    // 账本外移到 scripts 之后，组件提交带上一份欠账清单不需要 Also：那是账，不是别人线的实现。
    const withDebt = findViolations([
      {
        hash: 'ddd',
        subject: 'refactor(ui): move the backlog out of the component dir',
        message: 'refactor(ui): move the backlog out of the component dir\n\nComponent-Owner: 前端组件',
        authorDate: AFTER,
        files: [
          `${COMPONENTS_DIR}/popover/popoverCallSiteGuard.test.ts`,
          'scripts/migration-debt/popover.json'
        ]
      }
    ])
    expect(withDebt).toEqual([])

    // 同一目录里出现代码文件，仍按普通附带改动判——放行的只是 `.json`。
    const withCode = findViolations([
      {
        hash: 'eee',
        subject: 'refactor(ui): x',
        message: 'refactor(ui): x\n\nComponent-Owner: 前端组件',
        authorDate: AFTER,
        files: [`${COMPONENTS_DIR}/popover/popoverCallSiteGuard.test.ts`, 'scripts/migration-debt/notes.ts']
      }
    ])
    expect(withCode).toHaveLength(1)
  })

  it('does not judge commits older than the Also rule, and never asks for a reason on the component\'s own doc', () => {
    // 判定顺序：`Also:` 只判生效点之后的提交；组件自己的公开文档本来就在允许集合里。
    const commits = [
      {
        hash: 'old',
        subject: 'feat(state): before the rule',
        authorDate: BEFORE,
        message: 'feat(state): before the rule\n\nComponent-Owner: 前端组件\n',
        files: [`${COMPONENTS_DIR}/state/StateView.tsx`, 'platform/contracts/queryOutcome.ts']
      },
      {
        hash: 'new',
        subject: 'feat(state): doc follows the component',
        message: 'feat(state): doc follows the component\n\nComponent-Owner: 前端组件\n',
        authorDate: AFTER,
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

    expect(findViolations(shape(BEFORE))).toEqual([])
    expect(findViolations(shape(AFTER))).toHaveLength(1)
    // 读不出日期时从严判：兜底不许静默放行。
    expect(findViolations(shape('not-a-date'))).toHaveLength(1)
  })

  describe('later claim (one-off backfill)', () => {
    const untagged = {
      hash: 'd1d1d1d',
      subject: 'test(ui): relax the key-shape guard',
      message: 'test(ui): relax the key-shape guard',
      authorDate: AFTER,
      files: [`${COMPONENTS_DIR}/tooltip/tooltipCallSiteGuard.test.ts`, `${COMPONENTS_DIR}/textKeyShape.ts`]
    }
    const claim = (extra: readonly string[] = [], files: readonly string[] = ['scripts/check-components-ownership.mts']) => ({
      hash: 'c1c1c1c',
      subject: 'chore(ui): claim the guard commit',
      message: ['chore(ui): claim the guard commit', '', 'Component-Owner: 前端组件', 'Owns: d1d1d1d', ...extra].join('\n'),
      authorDate: LATER,
      files
    })


  it('lets the same owner fill in a missing Also line, but never a second owner', () => {
    // 2026-11-02 的现场：8e096aaa 已经声明了 Component-Owner，却漏了契约文件那行 `Also:`。
    // 那一半不是「归属不明」，是「理由漏写」——补的仍是对同一家的声明。
    const tagged = {
      hash: 'e1e1e1e',
      subject: 'feat(state): add a reason code',
      message: ['feat(state): add a reason code', '', 'Component-Owner: 前端组件'].join('\n'),
      authorDate: AFTER,
      files: [`${COMPONENTS_DIR}/state/StateView.tsx`, 'platform/contracts/queryOutcome.ts']
    }
    const claim = (owner: string, also: boolean) => ({
      hash: 'f1f1f1f',
      subject: 'chore: claim the code commit',
      message: [
        'chore: claim the code commit',
        '',
        `Component-Owner: ${owner}`,
        'Owns: e1e1e1e',
        ...(also ? ['Also: platform/contracts/queryOutcome.ts — the code lives there, the sentences here'] : [])
      ].join('\n'),
      authorDate: LATER,
      files: ['scripts/check-components-ownership.mts']
    })

    // 缺那一行 → 红；这是它的真实状态，不能因为“有 owner”就放过。
    expect(findViolations([tagged])).toHaveLength(1)
    // 同一家补上理由 → 绿。
    expect(findViolations([tagged, claim('前端组件', true)])).toEqual([])
    // 补了 `Owns:` 却没补理由 → 仍然红，认领不能只看声明。
    expect(findViolations([tagged, claim('前端组件', false)])).toHaveLength(1)
    // 别家来认领一笔已经归组件线的提交 → 不成立，那才是「两家争一笔」。
    expect(findViolations([tagged, claim('别的线', true)])).toHaveLength(1)
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

  it('lets a mechanical same-line deletion span many files without a trailer', () => {
    // `MI-11-R166`：同一行文本全仓一致删掉，允许整体一笔。判据是 diff，不是声明。
    const mechanical = {
      hash: 'aaa',
      subject: 'test(env): one place instead of 177',
      message: 'test(env): one place instead of 177',
      authorDate: '2026-11-02T15:00:00+08:00',
      files: [`${COMPONENTS_DIR}/tabs/Tabs.test.tsx`, 'apps/desktop-shell/x.test.ts']
    }
    expect(findViolations([mechanical], { isMechanicalDeletion: () => true })).toEqual([])
    // 没有豁免时照旧红——证明这条豁免不是「默认放行」。
    expect(findViolations([mechanical])).toHaveLength(1)
  })

  it('does not exempt a commit that also adds a line', () => {
    const adds = {
      hash: 'bbb',
      subject: 'test(ui): touch a component and delete a line',
      message: 'test(ui): touch a component and delete a line',
      authorDate: '2026-11-02T15:00:00+08:00',
      files: [`${COMPONENTS_DIR}/tabs/Tabs.tsx`]
    }
    expect(findViolations([adds], { isMechanicalDeletion: () => false })).toHaveLength(1)
  })
})
