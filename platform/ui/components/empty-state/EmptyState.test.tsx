import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EmptyState, type EmptyStateProps } from './EmptyState'

const here = __dirname
const source = readFileSync(join(here, 'EmptyState.tsx'), 'utf8')
const css = readFileSync(join(here, 'emptyState.css'), 'utf8')

describe('EmptyState', () => {
  it('renders exactly icon + title + reason and nothing else', () => {
    const markup = renderToStaticMarkup(
      <EmptyState title="No tools" reason="Nothing is registered yet." icon={<svg data-icon />} />
    )

    expect(markup).toBe(
      '<div class="empty-state" data-size="md"><svg data-icon="true"></svg>' +
        '<strong>No tools</strong><span>Nothing is registered yet.</span></div>'
    )
  })

  it('adds no wrapper element when there is no action', () => {
    const markup = renderToStaticMarkup(<EmptyState title="Empty" reason="Nothing here." />)

    expect(markup).not.toContain('<button')
    expect(markup).toBe(
      '<div class="empty-state" data-size="md"><strong>Empty</strong><span>Nothing here.</span></div>'
    )
  })

  it('renders the action only when one is given, and explains a disabled one', () => {
    const markup = renderToStaticMarkup(
      <EmptyState
        title="Empty"
        reason="Nothing here."
        action={{ label: 'Add one', onPress: () => undefined, disabledReason: 'Pick an agent first.' }}
      />
    )

    // 禁用原因必须读屏可达：挂在 aria-describedby 指向的 note 上，不用 title（读屏不念、触屏不出现）。
    expect(markup).toContain('aria-describedby="')
    expect(markup).toContain('role="note"')
    expect(markup).toContain('Pick an agent first.')
    expect(markup).not.toContain('title="Pick an agent first."')
  })

  it('keeps the legacy class for migrated sites without adding layout rules', () => {
    const markup = renderToStaticMarkup(<EmptyState title="T" reason="R" className="agent-empty-catalog" />)

    expect(markup).toContain('class="empty-state agent-empty-catalog"')
    // 迁移期不许有布局规则：加了就会在迁移当天改变间距。
    expect(css).not.toMatch(/\.empty-state\s*\{[^}]*display:\s*(flex|grid)/)
  })

  it('holds no copy of its own and no second loading implementation', () => {
    // 只允许注释里出现中文说明；JSX 与字符串里不许有文案。
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(withoutComments).not.toMatch(/[\u4e00-\u9fa5]/)
    expect(source).not.toMatch(/setInterval|spin|rotate/i)
    expect(css).not.toMatch(/var\([^)]*,\s*#/)
  })
})

/**
 * 编译期契约：缺必填字段、或把 `size` 写成 `page`，必须编译不过。
 * 运行时什么都不做——这两行的价值是让 tsc 校验 `@ts-expect-error`：
 * 一旦谁把 `title`/`reason` 改成可选，或把 size 放开，这里会先红。
 */
export function emptyStateTypeContract(): void {
  // @ts-expect-error title 必填
  const missingTitle: EmptyStateProps = { reason: 'why' }
  // @ts-expect-error reason 必填
  const missingReason: EmptyStateProps = { title: 'what' }
  // @ts-expect-error size 只允许 sm | md | lg
  const notASize: EmptyStateProps = { title: 't', reason: 'r', size: 'page' }
  void missingTitle
  void missingReason
  void notASize
}
