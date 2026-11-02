// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MetaChip, type MetaChipProps } from './MetaChip'

const source = readFileSync(join(__dirname, 'MetaChip.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'metaChip.css'), 'utf8')
/** 断言只看规则，不看注释。 */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): string {
  const start = rules.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`missing rule: ${selector}`)
  const body = rules.slice(rules.indexOf('{', start) + 1)
  return body.slice(0, body.indexOf('}'))
}

const key = (value: string): string => value

function props(overrides: Partial<MetaChipProps> = {}): MetaChipProps {
  return { labelKey: 'ui.test.category.macro', resolveText: key, ...overrides }
}

function markup(overrides: Partial<MetaChipProps> = {}): string {
  return renderToStaticMarkup(<MetaChip {...props(overrides)} />)
}

describe('MetaChip', () => {
  it('renders the sentence the caller resolved, never the key itself', () => {
    expect(markup({ resolveText: (value) => (value === 'ui.test.category.macro' ? '宏观' : '') })).toContain('>宏观<')
    // 未知键由调用方解析成空串；组件不回退成键名。
    expect(markup({ resolveText: () => '' })).toContain('></span>')
  })

  it('is a plain text span, not a control', () => {
    const html = markup()
    expect(html).toContain(`<span class="meta-chip">`)
    for (const forbidden of ['<button', 'role=', 'tabindex', 'onclick', '<svg', 'aria-', 'cursor']) {
      expect(html.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('offers exactly two props: a key and a resolver', () => {
    const propsType = source.slice(source.indexOf('export type MetaChipProps'), source.indexOf('export function MetaChip'))
    expect(propsType).toMatch(/labelKey:\s*string/)
    expect(propsType).toMatch(/resolveText:\s*\(key: string\) => string/)
    // `kind`/`text` 是 2026-11-02 回退掉的「数据标签」口子：一个组件两种内容语义，不再开。
    for (const escape of ['kind', 'text', 'tone', 'color', 'onClick', 'onSelect', 'icon', 'children', 'disabled', 'size']) {
      expect(propsType).not.toMatch(new RegExp(`\\b${escape}\\b`))
    }
  })

  it('keeps the whole look in one neutral rule: 18 high, 11px, radius 4, no dot, no capsule', () => {
    const body = block('.meta-chip')
    expect(body).toMatch(/display:\s*inline-flex/)
    expect(body).toMatch(/height:\s*18px/)
    expect(body).toMatch(/padding:\s*0 6px/)
    expect(body).toMatch(/border-radius:\s*4px/)
    expect(body).toMatch(/font-size:\s*11px/)
    expect(body).toMatch(/line-height:\s*1;/)
    expect(body).toMatch(/background:\s*var\(--surface-soft\)/)
    expect(body).toMatch(/color:\s*var\(--muted-strong\)/)
    expect(body).toMatch(/white-space:\s*nowrap/)
    // 没有圆点、没有胶囊、没有第二档颜色——那三样是 StatusPill 的形状。
    expect(body).not.toMatch(/border-radius:\s*(999px|[5-9]\d{2}px)/)
    expect(body).not.toMatch(/--pill-tone|--dot|border-radius:\s*50%/)
  })

  it('never looks clickable', () => {
    expect(rules).not.toMatch(/cursor:\s*pointer/)
  })

  it('imports no i18n and holds no copy', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/i18n|platformText|useShellLanguage/)
    expect(code).not.toMatch(/['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/)
  })
})
