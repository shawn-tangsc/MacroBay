import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Owner: platform/ui（**不许用「吃掉键」的解析器绕开文案表**）。
 *
 * `StateView` / `IconButton` 的读屏名只收键，句子由注入的 `resolveText` 解析。但
 * `resolveText={() => 已解析好的句子}` 一样能编译、一样能过键形状守卫——键形同虚设，
 * 自由文本只是换了一件合法外衣。这正是收键要防的事，靠规范写在纸上挡不住。
 *
 * 所以：产品代码里出现**零参箭头**当 `resolveText` 一律红；测试文件放行（测试就是要把键回显出来，
 * `(key) => key` 或 `() => 'fixed'` 都合理）。要一句固定文案，走**键 + 文案表**，不要喂空。
 */

const ROOT = process.cwd()
const SOURCE_ROOTS = ['products', 'apps/desktop-shell/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage'])
/** 零参箭头当解析器：`resolveText={() => …}`、`resolveText={ () => … }`、`resolveText={()=>…}` 全算。 */
const EMPTY_RESOLVER = /resolveText=\{\s*\(\s*\)\s*=>/

/** 只查代码，不查注释：注释里出现 `resolveText={() => …}` 是在解释这条规则，不是违规。 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    // 测试本来就要把键回显或钉死一句，放行。
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

describe('解析器不许吃掉键', () => {
  it('产品与外壳源码里没有零参 resolveText', () => {
    const offenders = SOURCE_ROOTS
      .flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
      .filter((file) => EMPTY_RESOLVER.test(codeOnly(readFileSync(resolve(ROOT, file), 'utf8'))))

    // 要固定文案就加键；把句子直接喂给解析器，等于让「键 → 句子」这条约定失效。
    expect(offenders).toEqual([])
  })
})

/**
 * §17 的同一类病：产品原因句改成「键 + 参数」之后，`resolve: (key) => t(key)` 会编译通过、
 * 键形状也对，但它把 `params` 吃掉了——界面上直接露出 `{moment}`。守卫只管能机械判的那半边：
 * 键必须带产品前缀、传了 `params` 就必须让 `resolve` 有第二个参数。
 */
const PRODUCT_REASON_BLOCK = /productReason=\{\{([\s\S]*?)\}\}/g
const PRODUCT_PREFIX = /^[a-z][a-z0-9]*\./
const TWO_PARAM_ARROW = /resolve:\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)/

export function productReasonOffenders(file: string, text: string): string[] {
  const offenders: string[] = []
  for (const match of codeOnly(text).matchAll(PRODUCT_REASON_BLOCK)) {
    const block = match[1] ?? ''
    const keyMatch = block.match(/\bkey:\s*'([^']+)'/)
    if (!keyMatch) {
      offenders.push(`${file}: productReason 没有字面键，判断不了前缀`)
      continue
    }
    const dictKey = keyMatch[1] ?? ''
    if (dictKey.startsWith('ui.')) {
      offenders.push(`${file}: 产品原因句不能借用平台前缀（${dictKey}）`)
    } else if (!PRODUCT_PREFIX.test(dictKey)) {
      offenders.push(`${file}: 产品原因句的键没有产品前缀（${dictKey}）`)
    }
    const passesParams = /\bparams:/.test(block)
    // 传了参数却给一个单参箭头：参数在解析器里被吃掉，界面上会露出 {占位}。
    if (passesParams && /resolve:\s*\(/.test(block) && !TWO_PARAM_ARROW.test(block)) {
      offenders.push(`${file}: 传了 params，但 resolve 只有一个参数，参数会被吃掉`)
    }
  }
  return offenders
}

describe('产品原因句：键带前缀、参数不被吃掉（§17）', () => {
  it('产品与外壳源码里的 productReason 都守规矩', () => {
    const offenders = SOURCE_ROOTS
      .flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
      .flatMap((file) => productReasonOffenders(file, readFileSync(resolve(ROOT, file), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('catches each shape it claims to catch', () => {
    const good = `productReason={{ key: 'sample.reason.staleSince', params: { moment: momentText }, resolve: (k, p) => t(k, p) }}`
    const platformPrefix = `productReason={{ key: 'ui.state.empty', resolve: (k, p) => t(k, p) }}`
    const noPrefix = `productReason={{ key: 'staleSince', resolve: (k, p) => t(k, p) }}`
    const eatsParams = `productReason={{ key: 'sample.reason.staleSince', params: { moment: momentText }, resolve: (k) => t(k) }}`

    expect(productReasonOffenders('good.tsx', good)).toEqual([])
    expect(productReasonOffenders('prefix.tsx', platformPrefix).length).toBe(1)
    expect(productReasonOffenders('plain.tsx', noPrefix).length).toBe(1)
    expect(productReasonOffenders('eats.tsx', eatsParams).length).toBe(1)
  })
})
