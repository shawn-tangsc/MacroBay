import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './EmptyState'

const here = __dirname
const source = readFileSync(join(here, 'EmptyState.tsx'), 'utf8')
const css = readFileSync(join(here, 'emptyState.css'), 'utf8')

describe('EmptyState', () => {
  it('renders exactly icon + title + reason and nothing else', () => {
    const markup = renderToStaticMarkup(
      <EmptyState title="No tools" reason="Nothing is registered yet." icon={<svg data-icon />} />
    )

    expect(markup).toBe(
      '<div class="empty-state" data-size="md" data-layout="block"><svg data-icon="true"></svg>' +
        '<strong>No tools</strong><span>Nothing is registered yet.</span></div>'
    )
  })

  it('adds no wrapper element when there is no action', () => {
    const markup = renderToStaticMarkup(<EmptyState title="Empty" reason="Nothing here." />)

    expect(markup).not.toContain('<button')
    expect(markup).toBe(
      '<div class="empty-state" data-size="md" data-layout="block"><strong>Empty</strong><span>Nothing here.</span></div>'
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

    expect(markup).toContain('<button type="button" class="empty-state-action" disabled="" title="Pick an agent first.">Add one</button>')
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
