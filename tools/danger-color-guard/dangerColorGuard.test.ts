import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  baselineKey,
  compareWithBaseline,
  formatViolations,
  scanDangerColor,
  stripCssComments,
  toBaseline
} from './dangerColorGuard'

const root = join(__dirname, '..', '..')
const baseline = JSON.parse(
  readFileSync(join(root, 'scripts', 'danger-color-baseline.json'), 'utf8')
) as Record<string, number>

describe('scanDangerColor', () => {
  it('finds the color declaration and reports the selector and line', () => {
    const css = ['.a {', '  color: var(--danger);', '}', ''].join('\n')

    expect(scanDangerColor(css, 'x.css')).toEqual([{ file: 'x.css', selector: '.a', line: 2 }])
  })

  it('ignores comments, unrelated properties and other tokens', () => {
    const css = [
      '/* color: var(--danger) 在注释里不算 */',
      '.b {',
      '  border-top-color: var(--danger);',
      '  background-color: var(--danger);',
      '  color: var(--warning);',
      '}'
    ].join('\n')

    expect(scanDangerColor(css, 'x.css')).toEqual([])
  })

  it('keeps two declarations in one rule apart when the baseline needs a count', () => {
    const uses = scanDangerColor('.c { color: var(--danger); }\n.d { color: var(--danger); }', 'x.css')

    expect(uses.map((use) => use.selector)).toEqual(['.c', '.d'])
  })

  it('does not let a stripped comment shift the reported line', () => {
    const stripped = stripCssComments('a {\n/*\n*/\n}\n')

    expect(stripped.split('\n').length).toBe(5)
  })
})

describe('compareWithBaseline', () => {
  const use = { file: 'x.css', selector: '.a', line: 1 }

  it('passes when the code matches the baseline exactly', () => {
    expect(compareWithBaseline([use], toBaseline([use]))).toEqual([])
  })

  it('reports a key over quota with the count and every line of that key', () => {
    const violations = compareWithBaseline([use], {})

    // 比较按计数做：不知道该键里哪一行是新的，就不假装知道。
    expect(violations).toEqual([
      { kind: 'over-quota', file: 'x.css', selector: '.a', extra: 1, lines: [1] }
    ])
  })

  it('lists both lines when a key gains a second use', () => {
    const violations = compareWithBaseline(
      [{ file: 'x.css', selector: '.y', line: 3 }, { file: 'x.css', selector: '.y', line: 1 }],
      toBaseline([{ file: 'x.css', selector: '.y', line: 1 }])
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: 'over-quota', extra: 1, lines: [1, 3] })
  })

  it('reports a stale baseline entry so the list cannot drift from the code', () => {
    const violations = compareWithBaseline([], { [baselineKey('x.css', '.gone')]: 1 })

    expect(violations).toEqual([{ kind: 'stale', file: 'x.css', selector: '.gone' }])
  })

  it('fails an entry with no selector instead of skipping it', () => {
    // 跳过等于留一个永久盲区：基线看起来在管，其实那一行没人看。
    const violations = compareWithBaseline([], { 'x.css :: ': 1 })

    expect(violations).toEqual([{ kind: 'malformed', file: 'x.css', selector: '' }])
    expect(formatViolations(violations)).toContain('基线缺选择器')
  })

  it('names the file, selector and every line in the failure output', () => {
    const message = formatViolations([
      { kind: 'over-quota', file: 'x.css', selector: '.a', extra: 1, lines: [3, 7] }
    ])

    expect(message).toContain('x.css')
    expect(message).toContain('.a')
    expect(message).toContain('比基线多 1 处')
    expect(message).toContain('3, 7')
  })

  it('matches a fallback value, inner spaces and an upper-case property', () => {
    const css = [
      '.f { color: var(--danger, #c00); }',
      '.g { color: var(--danger, var(--text-strong)); }',
      '.h { color: var( --danger ); }',
      '.i { COLOR: var(--danger); }'
    ].join('\n')

    expect(scanDangerColor(css, 'x.css').map((use) => use.selector)).toEqual(['.f', '.g', '.h', '.i'])
  })

  it('still rejects look-alike token names and other colour properties', () => {
    const css = [
      '.a { color: var(--dangerous); }',
      '.b { color: var(--danger-soft); }',
      '.c { border-left-color: var(--danger); }'
    ].join('\n')

    expect(scanDangerColor(css, 'x.css')).toEqual([])
  })
})

describe('the recorded baseline', () => {
  it('is not empty and every entry names a file and a selector', () => {
    const keys = Object.keys(baseline)

    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(key).toContain(' :: ')
      expect(baseline[key]).toBeGreaterThan(0)
    }
  })
})
