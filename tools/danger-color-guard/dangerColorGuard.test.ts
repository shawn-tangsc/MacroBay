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

  it('reports an added use outside the baseline', () => {
    const violations = compareWithBaseline([use], {})

    expect(violations).toEqual([{ kind: 'added', file: 'x.css', selector: '.a', line: 1 }])
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

  it('names the file, selector and line in the failure output', () => {
    const message = formatViolations([{ kind: 'added', file: 'x.css', selector: '.a', line: 7 }])

    expect(message).toContain('x.css:7')
    expect(message).toContain('.a')
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
