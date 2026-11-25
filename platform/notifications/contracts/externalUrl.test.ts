import { describe, expect, it } from 'vitest'

import { isExternalUrl } from './externalUrl'

/**
 * 「能不能交给 shell 打开」只有这一个判据（主进程出口与渲染层动作按钮共用）。
 *
 * 2026-11-24 的事故形状：两处各写一套——主进程 `startsWith('https://')`（大小写敏感）、
 * 抽屉正则带 `i`——`HTTP://x` 抽屉画得出按钮、点下去主进程 throw，调用点又吞掉 rejection，
 * 于是那颗按钮点了没反应。所以这四条必须钉死，两边结论一致。
 */
describe('isExternalUrl', () => {
  it.each([
    ['http://example.test/a', true],
    ['https://example.test/a', true],
    ['HTTP://EXAMPLE.TEST/a', true],
    ['HtTpS://example.test/a', true],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
    ['', false]
  ])('%s → %s', (value, expected) => {
    expect(isExternalUrl(value)).toBe(expected)
  })

  it('非字符串一律拒（记录里的字段是外部输入，别指望上游一定是字符串）', () => {
    expect(isExternalUrl(undefined)).toBe(false)
    expect(isExternalUrl(null)).toBe(false)
    expect(isExternalUrl(42)).toBe(false)
    expect(isExternalUrl({ url: 'https://example.test' })).toBe(false)
  })
})
