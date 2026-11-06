import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { evaluate, runGate, scanDefinitions, scanUses, type Whitelist } from './check-undefined-token.mts'

/**
 * 这条门禁自己也要有守卫。
 *
 * 三件事，别的都次要：
 * ① **造坏必须看到红**：样本里一处无兜底、一处带兜底，脚本必须双双报出来，并且位置指得准；
 * ② 注释里的 `var(--x)` 既不算引用也不算定义——`tokens.css` 的文档注释里就有一处反例写法，
 *    不排掉这条门禁第一天就带着一条永远修不掉的账；
 * ③ 白名单**双向**校验：笔误不许借「运行时注入」放行（注入文件里找不到名字就红），条目过期也要红
 *    （名字已经没有未定义引用、或者静态 CSS 里补了定义）。名单一旦只能加，它三天后就是新的藏身处。
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/undefined-token-guard/', import.meta.url))

const readNothing = (): null => null

describe('undefined token scan', () => {
  it('reads a bare use, a use with a fallback, and a use split across lines', () => {
    const uses = scanUses(`.a { width: var(--a); }\n.b { color: var( --b , #fff ); }\n.c { width: var(\n  --c\n); }`, 'demo.css')

    expect(uses.map((use) => [use.name, use.fallback, use.line])).toEqual([
      ['a', false, 1],
      ['b', true, 2],
      // 跨行的 var() 报 `var(` 这一行，不报变量名那一行：读者要改的是这条声明。
      ['c', false, 3]
    ])
  })

  it('does not shorten a longer name to a prefix', () => {
    const uses = scanUses('.a { width: var(--a-b); }', 'demo.css')
    const defined = scanDefinitions(':root { --a: 1px; }')

    expect(uses.map((use) => use.name)).toEqual(['a-b'])
    expect(defined).toEqual(['a'])
  })

  it('ignores references and definitions inside comments', () => {
    const css = `/* var(--ghost) */\n/* --ghost: #fff; */\n.a { width: var(--ghost); }`
    const uses = scanUses(css, 'demo.css')

    expect(uses).toHaveLength(1)
    expect(uses[0]?.line).toBe(3)
    expect(scanDefinitions(css)).toEqual([])
  })

  it('lets a definition in one file cover a use in another', () => {
    const report = evaluate({
      files: [
        { file: 'tokens.css', css: ':root { --shared: #fff; }' },
        { file: 'page.css', css: '.a { color: var(--shared); }' }
      ],
      readText: readNothing,
      whitelist: {}
    })

    expect(report.ok).toBe(true)
  })
})

describe('undefined token gate', () => {
  it('goes red on the broken sample and names both uses', () => {
    const report = runGate(`${FIXTURES}broken`, { roots: ['apps'], whitelistPath: `${FIXTURES}broken/whitelist.json` })

    expect(report.ok).toBe(false)
    expect(report.output).toContain('无兜底 1 处 / 1 个名字')
    expect(report.output).toContain('带硬编码兜底 1 处 / 1 个名字')
    expect(report.output).toContain('apps/demo/broken.css:10  --ghost-size')
    expect(report.output).toContain('apps/demo/broken.css:14  --ghost-border')
    // 注释里的名字既不许出现在报告里，也不许被当成定义。
    expect(report.output).not.toContain('ghost-in-comment')
    // 真定义过的名字当然也不许报。
    expect(report.output).not.toContain('--real-token')
  })

  it('goes green on the fixed sample, with the injected name counted as whitelisted', () => {
    const report = runGate(`${FIXTURES}fixed`, { roots: ['apps'], whitelistPath: `${FIXTURES}fixed/whitelist.json` })

    expect(report.ok).toBe(true)
    expect(report.output).toContain('未定义 0 处')
  })

  it('refuses a whitelist entry whose injection file does not contain the name', () => {
    const whitelist: Whitelist = {
      '--typo-width': {
        injectedBy: 'injected.tsx:1',
        file: 'apps/demo/injected.tsx',
        reason: '看着像运行时注入。'
      }
    }
    const report = evaluate({
      files: [{ file: 'demo.css', css: '.a { width: var(--typo-width); }' }],
      readText: () => `export const style = { '--something-else': '10px' }`,
      whitelist
    })

    expect(report.ok).toBe(false)
    expect(report.output).toContain('注入点不成立')
  })

  it('refuses a stale entry: no use left, or the value got a static definition', () => {
    const leftNone = evaluate({
      files: [],
      readText: () => `const s = { '--gone': '1px' }`,
      whitelist: {
      '--gone': { injectedBy: 'a.tsx:1', file: 'a.tsx', reason: '旧账。' }
    } })
    expect(leftNone.ok).toBe(false)
    expect(leftNone.output).toContain('已经没有未定义引用了')

    const nowStatic = evaluate({
      files: [{ file: 'tokens.css', css: ':root { --now-static: #fff; }' }],
      readText: () => `const s = { '--now-static': '1px' }`,
      whitelist: { '--now-static': { injectedBy: 'a.tsx:1', file: 'a.tsx', reason: '旧账。' } }
    })
    expect(nowStatic.ok).toBe(false)
    expect(nowStatic.output).toContain('白名单条目过期')
  })

  it('refuses an entry that cannot state where the value comes from', () => {
    const report = evaluate({
      files: [{ file: 'demo.css', css: '.a { width: var(--mystery); }' }],
      readText: () => `const s = { '--mystery': '1px' }`,
      whitelist: { '--mystery': { injectedBy: ' ', file: 'a.tsx', reason: '  ' } }
    })

    expect(report.ok).toBe(false)
    expect(report.output).toContain('缺 injectedBy / file / reason')
  })
})
