import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FAILURE_ELLIPSIS,
  FAILURE_REASON_BUDGET,
  anchorPaths,
  presentBootFailure,
  truncateForScreen
} from './failurePresentation'

/** 失败页在「别的都挂了」时才出现，它的依赖面就是它的生存条件。 */
const FAILURE_PAGE_FILES = ['failurePresentation.ts', 'bootFailurePage.ts', 'bootFailureWindow.ts']

function importedModules(relativePath: string): string[] {
  const source = readFileSync(resolve(__dirname, relativePath), 'utf8')
  return [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gmu)].map((match) => match[1])
}

describe('failure page dependency surface', () => {
  it('imports nothing that could be the thing that broke', () => {
    for (const file of FAILURE_PAGE_FILES) {
      for (const module of importedModules(file)) {
        const allowed =
          // 平台唯一的凭据模式表：纯函数，失败页要用它把 token 从错误消息里拿掉。
          module.endsWith('secrets/redaction/redactText') ||
          // 同目录的失败页模块。
          module.startsWith('./') ||
          // 主进程框架本身：页面要在 Electron 里活着，这是它的宿主不是依赖。
          module === 'electron' ||
          // 纯工具。
          module === 'node:path' ||
          module === 'node:fs'
        expect({ file, module, allowed }).toEqual({ file, module, allowed: true })
      }
    }
  })

  it('keeps the three files free of settings, i18n, theme and product imports', () => {
    for (const file of FAILURE_PAGE_FILES) {
      const modules = importedModules(file).join('\n')
      expect(modules).not.toMatch(/settings|i18n|platformText|theme|@products|products\//u)
    }
  })
})

describe('failure presentation', () => {
  it('anchors every POSIX and Windows home path form the acceptance list names', () => {
    // 五种形态各一条：只挡 POSIX 等于只挡住一半用户，而 Windows 用户最常追问「这个路径在哪」。
    expect(anchorPaths("Cannot find module '/Users/alice/project/AI/MacroBay/products/market-intelligence/product.manifest.ts'"))
      .toBe(`Cannot find module '${FAILURE_ELLIPSIS}/products/market-intelligence/product.manifest.ts'`)
    expect(anchorPaths("Cannot find module '/home/bob/work/platform/desktop/main/app.ts'"))
      .toBe(`Cannot find module '${FAILURE_ELLIPSIS}/platform/desktop/main/app.ts'`)
    expect(anchorPaths('Cannot find module C:\\Users\\carol\\MacroBay\\apps\\desktop-shell\\main.ts'))
      .toBe(`Cannot find module ${FAILURE_ELLIPSIS}/apps/desktop-shell/main.ts`)
    expect(anchorPaths('Cannot find module \\\\?\\C:\\Users\\carol\\MacroBay\\scripts\\release\\bump.mts'))
      .toBe(`Cannot find module ${FAILURE_ELLIPSIS}/scripts/release/bump.mts`)
    expect(anchorPaths('Failed to load file:///Users/alice/project/AI/MacroBay/products/x/manifest.ts'))
      .toBe(`Failed to load ${FAILURE_ELLIPSIS}/products/x/manifest.ts`)
  })

  it('keeps only the file name when a path has no repository anchor', () => {
    expect(anchorPaths('open /Users/alice/secret/notes.txt failed')).toBe(`open ${FAILURE_ELLIPSIS}/notes.txt failed`)
  })

  it('redacts credentials before anchoring, so a token cannot survive the path cut', () => {
    // 反例：先锚路径会把 /Users/x 段切掉，token 留在屏幕上。顺序必须是先凭据、后路径。
    const screen = presentBootFailure({
      code: 'product-bootstrap-failed',
      stage: 'register-product-services',
      productId: 'market-intelligence',
      reason: 'request to https://user:ghp_abcdefghijklmnopqrstuvwxyz0123456789@host/Users/alice/repo/products/x.ts failed'
    })

    expect(screen.reason).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(screen.reason).not.toContain('/Users/alice')
    expect(screen.reason).toContain('products/x.ts')
    // 日志侧由 productBootstrap 写 `detail.reason` 原文（那条由它自己的用例守着）；
    // 屏幕侧不承载原文，避免同一事实两份记录。
    expect(screen.reasonFull).not.toContain('/Users/alice')
  })

  it('truncates the screen reason with a real ellipsis and leaves the log reason whole', () => {
    const long = `Cannot find module '.${'/products/'}${'very-long-segment.'.repeat(30)}ts'`
    const screen = presentBootFailure({
      code: 'product-bootstrap-failed',
      stage: 'register-product-services',
      productId: null,
      reason: long
    })

    expect(screen.reason.endsWith(FAILURE_ELLIPSIS)).toBe(true)
    expect(screen.reason).not.toContain('...')
    expect(screen.reason.length).toBeLessThan(long.length)
  })

  it('keeps a short reason untouched and folds whitespace', () => {
    expect(truncateForScreen('boom\n  at  app.ts')).toBe('boom at app.ts')
    expect(truncateForScreen('short')).toBe('short')
  })

  it('measures CJK and latin widths differently instead of counting code points', () => {
    const cjk = '错'.repeat(FAILURE_REASON_BUDGET)
    // 汉字按 2 单位计：72 个汉字就到预算，第 73 个必须被裁掉。
    expect(truncateForScreen(cjk)).toHaveLength(FAILURE_REASON_BUDGET / 2 - 1 + 1)
    expect(truncateForScreen('a'.repeat(FAILURE_REASON_BUDGET))).toBe('a'.repeat(FAILURE_REASON_BUDGET))
    expect(truncateForScreen('a'.repeat(FAILURE_REASON_BUDGET + 1)).endsWith(FAILURE_ELLIPSIS)).toBe(true)
  })

  it('exposes exactly the screen fields the page renders, no extras', () => {
    const screen = presentBootFailure({
      code: 'product-bootstrap-failed',
      stage: 'register-product-services',
      productId: 'market-intelligence',
      reason: 'boom'
    })
    // 多一个键不会报错，只会在半年后被人当成事实；三个名字各说明一层。
    expect(Object.keys(screen).sort()).toEqual(['code', 'productId', 'reason', 'reasonFull', 'stage'])
  })

  it('never truncates or rewrites the error code', () => {
    const screen = presentBootFailure({
      code: 'product-bootstrap-failed',
      stage: 'seal-ipc-surface',
      productId: 'market-intelligence',
      reason: 'x'.repeat(1000)
    })
    expect(screen.code).toBe('product-bootstrap-failed')
    expect(screen.stage).toBe('seal-ipc-surface')
    expect(screen.productId).toBe('market-intelligence')
  })
})
