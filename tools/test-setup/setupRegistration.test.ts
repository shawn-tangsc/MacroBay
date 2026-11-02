import { describe, expect, it } from 'vitest'

/**
 * 这条断言文件本身跑在 **node 环境**（没有 DOM），所以它同时证明两件事：
 * 1. 仓库确实把 `tools/test-setup/domFramePolyfill.ts` 注册成了 setup（否则这里没有 rAF）；
 * 2. 补齐是**全局一次**，不是各线在各自用例里打补丁。
 *
 * 谁把 `vitest.config.ts` 里的 `setupFiles` 删掉，这里先红——而不是等某条产品线
 * 换组件基座时崩在 `requestAnimationFrame is not defined` 上，再回头查是谁的问题。
 */
describe('dom frame setup', () => {
  it('runs without a DOM, yet still has a frame loop', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof globalThis.requestAnimationFrame).toBe('function')
    expect(typeof globalThis.cancelAnimationFrame).toBe('function')
  })
})
