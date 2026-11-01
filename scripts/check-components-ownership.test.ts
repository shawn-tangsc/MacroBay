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
        files: [`${COMPONENTS_DIR}/menu/ContextMenu.tsx`]
      },
      {
        hash: 'ccc',
        subject: 'feat(notifications): unrelated',
        message: 'feat(notifications): unrelated',
        files: ['platform/notifications/runtime/notificationRuntime.ts']
      }
    ])
    expect(violations).toEqual([])
  })
})
