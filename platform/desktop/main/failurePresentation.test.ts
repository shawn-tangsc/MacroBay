import { describe, expect, it } from 'vitest'

import {
  FAILURE_ELLIPSIS,
  FAILURE_REASON_BUDGET,
  anchorPaths,
  presentBootFailure,
  truncateForScreen
} from './failurePresentation'

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
    // 日志视图保留原文，一个字不改：屏幕给方向，日志给证据。
    expect(screen.reasonForLog).toContain('/Users/alice')
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
    expect(screen.reasonForLog).toBe(long)
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
