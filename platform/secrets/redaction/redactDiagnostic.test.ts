import { describe, expect, it } from 'vitest'

import { anchorPaths } from './anchorPaths'
import { redactDiagnosticText } from './redactDiagnostic'

/**
 * 诊断脱敏的验收：顺序（凭据最先）、URL 的值、home 与其它绝对路径、不截断。
 *
 * 启动失败页与产品页失败折叠区读同一个入口，所以这些用例就是两处的共同证据。
 */
describe('redactDiagnosticText', () => {
  it('redacts credentials first, then URL userinfo and query/fragment values while keeping keys', () => {
    const out = redactDiagnosticText(
      'request https://user:SUPERSECRETTOKEN@example.com/api?key=abcdefghijklmnop&page=2#token=zzz failed'
    )

    // userinfo 整段、query 与 fragment 的值都不留；键与结构保留。
    expect(out).toBe('request https://***@example.com/api?key=***&page=***#token=*** failed')
    expect(out).not.toContain('SUPERSECRETTOKEN')
  })

  it('redacts a credential token inside userinfo before anything that could eat the delimiter', () => {
    const out = redactDiagnosticText(
      'connect https://user:ghp_abcdefghijklmnopqrstuvwxyz0123456789@host/x failed'
    )

    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(out).toContain('https://***@host/x')
  })

  it('turns every home path form into ~/<file name>', () => {
    expect(anchorPaths("Cannot find module '/Users/alice/proj/file.ts'")).toBe("Cannot find module '~/file.ts'")
    expect(anchorPaths('Cannot find module C:\\Users\\bob\\proj\\x.js')).toBe('Cannot find module ~/x.js')
    expect(anchorPaths('Cannot find module \\\\?\\C:\\Users\\carol\\repo\\y.ts')).toBe('Cannot find module ~/y.ts')
    expect(anchorPaths('Failed to load file:///Users/alice/repo/z.ts')).toBe('Failed to load ~/z.ts')
    expect(anchorPaths('open /home/dave/repo/w.ts failed')).toBe('open ~/w.ts failed')
  })

  it('keeps repository-relative paths and shortens other absolute paths to the last segment', () => {
    const repo = redactDiagnosticText("Cannot find module '/srv/ci/MacroBay/platform/desktop/main/app.ts'")
    expect(repo).toBe("Cannot find module '…/platform/desktop/main/app.ts'")

    const other = redactDiagnosticText('open /var/tmp/build/x.js failed')
    expect(other).toBe('open …/x.js failed')
  })

  it('never truncates: plain long text comes back byte-for-byte', () => {
    const plain = '这是一个很长的诊断句子，没有任何路径与凭据。'.repeat(50)
    expect(redactDiagnosticText(plain)).toBe(plain)
  })

  it('leaves empty and whitespace-only text alone', () => {
    expect(redactDiagnosticText('')).toBe('')
    expect(redactDiagnosticText(' \n\t')).toBe(' \n\t')
  })
})
