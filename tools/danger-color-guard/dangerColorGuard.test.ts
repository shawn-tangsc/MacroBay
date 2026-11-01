import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  baselineKey,
  compareWithBaseline,
  formatViolations,
  scanDangerColor,
  scanHexColorLiteral,
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

describe("baseline class references", () => {
  /**
   * 名字只说它证明的事：它查的是**选择器里任意一个类名在源码里以整词出现过**，
   * 不证明这条规则命中元素——类名还在、却挂到了别的元素上，它照样绿。
   *
   * 名字里的 `at least one` 不是啰嗦：判据是「任意一个类名整词出现」，所以它证明的是
   * 「这条选择器不像完全死掉」，**不是**「这条规则还活着」。`.a.b` 里 `.b` 死了、`.a` 还在用，
   * 本断言照样绿——「部分类名已死、其余仍在」属于界面验收范围，机器查不了。
   *
   * 两类**预期内的类名缺失**（看到它们不要改成别的判断依据）：
   * - 库运行时类：`ant-tag` 由 Ant Design 在运行时加，源码里当然没有；
   * - 模板拼接类：`is-${state}` 这类，字面串 `is-failed` 永远搜不到。
   *
   * 词表正则要求**至少 3 个字符**（`[A-Za-z][A-Za-z0-9_-]{2,}`），所以 `.mb`、`.ui` 这种短类名
   * 不参与本检查——将来谁写一个 `.sm` 并进了基线，会红且找不到原因。今天 61 条里没有短于 3 个字符的类名。
   *
   * 不取「主类名」：`.model-availability-icon.is-failed` 这类是模板拼的
   * （`is-${state}`），字面串永远搜不到，取主类名会误报成死规则。
   * 也不用 `includes`：那会把 `data-model-availability-icon` 当成类名命中。
   */
  const SOURCE_ROOTS = ['apps', 'platform', 'products']
  const SOURCE_EXTENSIONS = ['.ts', '.tsx']

  function collectSourceTokens(): Set<string> {
    const tokens = new Set<string>()
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        if (name === 'node_modules' || name.startsWith('.')) continue
        const full = join(directory, name)
        const stat = statSync(full)
        if (stat.isDirectory()) {
          walk(full)
          continue
        }
        if (!SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension))) continue
        if (name.includes('.test.') || name.includes('.spec.')) continue
        for (const token of readFileSync(full, 'utf8').match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []) {
          tokens.add(token)
        }
      }
    }
    for (const root of SOURCE_ROOTS) walk(root)
    return tokens
  }

  it("keeps at least one class of every baseline selector referenced from source", () => {
    const tokens = collectSourceTokens()
    const dead = Object.keys(baseline).map((key) => {
      const [file = key, selector = ''] = key.split(' :: ')
      const classes = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] ?? '')
      return { file, selector, classes }
    }).filter((entry) => entry.classes.length > 0 && !entry.classes.some((name) => tokens.has(name)))

    expect(
      dead.map((entry) => `${entry.file} :: ${entry.selector}（类名 ${entry.classes.join(', ')}）`)
    ).toEqual([])
  }, 60_000)
})

describe('scanHexColorLiteral', () => {
  it('finds a literal foreground colour with its selector and line', () => {
    const css = ['.a {', '  color: #dc2626;', '}', ''].join('\n')

    expect(scanHexColorLiteral(css, 'x.css')).toEqual([
      { file: 'x.css', selector: '.a', line: 2, value: '#dc2626' }
    ])
  })

  it('ignores other colour properties, var() values and look-alike names', () => {
    const css = [
      '.b { border-color: #dc2626; }',
      '.c { background-color: #dc2626; }',
      '.d { color: var(--danger); }',
      '/* color: #dc2626 在注释里不算 */',
      '.g { color: var(--x, #dc2626); }'
    ].join('\n')

    expect(scanHexColorLiteral(css, 'x.css').map((use) => use.selector)).toEqual([])
  })

  it('treats an 8-digit literal as a literal', () => {
    expect(scanHexColorLiteral('.f { COLOR: #11223344; }', 'x.css').map((use) => use.value)).toEqual(['#11223344'])
  })
})
