// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { STATUS_PILL_TONES, StatusPill, type StatusPillProps, type StatusPillTone } from './StatusPill'

const source = readFileSync(join(__dirname, 'StatusPill.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'statusPill.css'), 'utf8')
/** 断言只看规则，不看注释。 */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 取某个选择器的规则体，用来断言「这一档用的是哪个 token」。 */
function block(selector: string): string {
  const start = rules.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`missing rule: ${selector}`)
  const body = rules.slice(rules.indexOf('{', start) + 1)
  return body.slice(0, body.indexOf('}'))
}

const key = (value: string): string => value

function props(overrides: Partial<StatusPillProps> = {}): StatusPillProps {
  return { tone: 'ok', labelKey: 'ui.test.status.enabled', resolveText: key, ...overrides }
}

function markup(overrides: Partial<StatusPillProps> = {}): string {
  return renderToStaticMarkup(<StatusPill {...props(overrides)} />)
}

describe('StatusPill', () => {
  it('offers the five tones and no sixth', () => {
    expect(STATUS_PILL_TONES).toEqual(['ok', 'warn', 'bad', 'info', 'muted'])
  })

  it.each(STATUS_PILL_TONES)('renders its tone as a class, so one rule per state: %s', (tone: StatusPillTone) => {
    expect(markup({ tone })).toContain(`status-pill--${tone}`)
  })

  it('takes the status word from the resolver, never from the raw key', () => {
    const seen: string[] = []
    const resolved = (value: string): string => {
      seen.push(value)
      return '已启用'
    }

    const html = markup({ labelKey: 'ui.test.status.enabled', resolveText: resolved })

    expect(html).toContain('已启用')
    expect(html).not.toContain('ui.test.status.enabled')
    expect(seen).toEqual(['ui.test.status.enabled'])
  })

  it('says its state in words, with the dot only as a helper', () => {
    const html = markup({ resolveText: () => '读取失败' })

    // 药丸必须有字：把颜色关掉、转灰度之后，读者只剩这些字可以分辨档位。
    expect(html).toContain('<span class="status-pill__label">读取失败</span>')
    expect(html).toContain('aria-hidden="true"')
  })

  it('is a status, not a control: it renders no button and takes no click', () => {
    const html = markup()

    expect(html.startsWith('<span')).toBe(true)
    expect(html).not.toContain('<button')
    expect(source).not.toContain('onClick')
  })

  it('sets one type size only: 11px, never 9px', () => {
    const sizes = [...rules.matchAll(/font-size:\s*([\w.]+)/g)].map((match) => match[1])

    expect(sizes).toEqual(['11px'])
    expect(rules).not.toMatch(/\b9px\b/)
  })

  it('keeps the answer legible rather than shrinking it: no line-height below 1.5, no truncation tricks', () => {
    expect(block('.status-pill')).toContain('line-height: 1.5')
    expect(rules).not.toMatch(/text-overflow|font-size:\s*smaller|transform:\s*scale/)
  })

  it('takes every colour from a token, with no hex of its own', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rules).not.toMatch(/var\(--[\w-]+,\s*#/)
  })

  it('maps each tone to its own token, so two states never share one colour', () => {
    expect(block('.status-pill--ok')).toContain('var(--success)')
    expect(block('.status-pill--warn')).toContain('var(--caution)')
    expect(block('.status-pill--bad')).toContain('var(--danger)')
    expect(block('.status-pill--info')).toContain('var(--accent)')
    expect(block('.status-pill--muted')).toContain('var(--muted)')

    // `--warning` 是 `--caution` 的旧别名：新代码用它等于又写出第二个黄。
    expect(rules).not.toContain('--warning')
  })

  it('never paints the status word in a status colour: the tone rides on the dot and the border', () => {
    // 硬门禁 `check:danger-color` 只减不增：`color: var(--danger)` 这类前景在深色下
    // 是 3.25–3.94，而 11px 的药丸字就是正文（门槛 4.5）。所以字用正文色。
    expect(block('.status-pill')).toContain('color: var(--text-strong)')
    expect(rules).not.toMatch(/color:\s*var\(--(danger|success|caution|accent)\)/)
  })

  it('does not paint warn as an error: warn and bad read different tokens', () => {
    expect(block('.status-pill--warn')).not.toContain('--danger')
    expect(block('.status-pill--bad')).not.toContain('--caution')
  })

  it('carries no copy of its own and no motion', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(code).not.toMatch(/[\u4e00-\u9fff]/)
    expect(rules).not.toMatch(/@keyframes|animation|transition/)
  })
})
