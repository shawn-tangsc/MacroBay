import { describe, expect, it } from 'vitest'

import type { CollapsibleGroupProps } from './CollapsibleGroup'

/**
 * `rows` 与 `children` 互斥：写在 `.ts` 里，主 `typecheck` 才看得见
 * （主配置不收平台下的 `.tsx`，这两种形状若写错只有提交钩子能发现）。
 */
describe('CollapsibleGroup content shape', () => {
  it('takes rows or children, never both and never neither', () => {
    // @ts-expect-error 两种形态互斥
    const both: CollapsibleGroupProps = { titleKey: 'k', resolveText: (key: string) => key, rows: [], children: null }
    expect(both).toBeDefined()

    // @ts-expect-error 至少要给一种形态
    const neither: CollapsibleGroupProps = { titleKey: 'k', resolveText: (key: string) => key }
    expect(neither).toBeDefined()
  })
})
