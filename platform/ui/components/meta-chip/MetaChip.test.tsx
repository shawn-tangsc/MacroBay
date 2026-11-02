// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MetaChip, type MetaChipLabel, type MetaChipProps } from './MetaChip'

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
  return { ...{ kind: 'textKey' as const, labelKey: 'ui.test.category.macro' }, resolveText: key, ...overrides }
}

function markup(overrides: Partial<MetaChipProps> = {}): string {
  return renderToStaticMarkup(<MetaChip {...props(overrides)} />)
}

describe('MetaChip', () => {
  it('renders the sentence the caller resolved, never the key itself', () => {
    expect(
      markup({ kind: 'textKey', labelKey: 'ui.test.category.macro', resolveText: (value) => (value === 'ui.test.category.macro' ? '宏观' : '') })
    ).toContain('>宏观<')
    // 未知键由调用方解析成空串；组件不回退成键名。
    expect(markup({ kind: 'textKey', resolveText: () => '' })).toContain('></span>')
  })

  it('is a plain text span, not a control', () => {
    const html = markup()
    expect(html).toContain(`<span class="meta-chip">`)
    for (const forbidden of ['<button', 'role=', 'tabindex', 'onclick', '<svg', 'aria-', 'cursor']) {
      expect(html.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('offers exactly two sources and a resolver: a key, a raw text, and how to resolve the key', () => {
    const propsType = source.slice(source.indexOf('export type MetaChipLabel'), source.indexOf('export function MetaChip'))
    expect(propsType).toMatch(/kind: 'textKey'; labelKey: string/)
    expect(propsType).toMatch(/kind: 'text'; text: string/)
    expect(propsType).toMatch(/resolveText:\s*\(key: string\) => string/)
    for (const escape of ['tone', 'color', 'onClick', 'onSelect', 'icon', 'children', 'disabled', 'size']) {
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

  it('never resolves a raw value: text bypasses the resolver, so switching language cannot change it', () => {
    // 这条是 `kind` 存在的全部理由。数据不是句子——让它经过 `resolveText`，等于假装它会被翻译，
    // 而真相是：工具 id、registry 名、`yaml` 这类标识在英文界面里也不该变。
    const resolver = (value: string): string => `resolved:${value}`
    const html = renderToStaticMarkup(<MetaChip kind="text" text="claude-plugins" resolveText={resolver} />)

    expect(html).toContain('>claude-plugins<')
    expect(html).not.toContain('resolved:')
  })

  it('makes the two sources look different, so a raw identifier never reads as a sentence', () => {
    // `scheduled_task_run_now` 以正文的样子出现在一句中文中间，读者会以为那是写错的词。
    const sentence = renderToStaticMarkup(<MetaChip kind="textKey" labelKey="ui.test.category.macro" resolveText={() => '宏观'} />)
    const data = renderToStaticMarkup(<MetaChip kind="text" text="yaml" resolveText={key} />)

    expect(sentence).not.toContain('meta-chip--data')
    expect(data).toContain('meta-chip--data')
    expect(block('.meta-chip--data')).toMatch(/font-family:\s*[^;]*monospace/)
  })

  it('requires the caller to say which source it is: there is no default', () => {
    // 类型层面钉住：缺 `kind` 编译不过。给人默认值，下一个人就会不假思索地用 `text`，
    // 而 `text` 跳过 i18n——某一枚标签在英文界面里还是中文，且没有任何检查会红。
    const withoutKind = { labelKey: 'ui.test.category.macro', resolveText: key }
    // @ts-expect-error `kind` 必填：两个分支都不是「默认」。
    const missing: MetaChipLabel = withoutKind
    void missing
    expect(source).toMatch(/export type MetaChipLabel = \{ kind: 'textKey'/)
  })
})
