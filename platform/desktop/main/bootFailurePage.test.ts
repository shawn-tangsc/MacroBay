import { describe, expect, it } from 'vitest'

import { formatBootFailureLogPath, renderBootFailurePage, resolveBootFailureAction } from './bootFailurePage'
import type { ScreenFailure } from './failurePresentation'

const failure: ScreenFailure = {
  code: 'product-bootstrap-failed',
  stage: 'register-product-services',
  productId: 'market-intelligence',
  reason: `Cannot find module '…/products/market-intelligence/product.manifest.ts'`,
  reasonFull: `Cannot find module '…/products/market-intelligence/product.manifest.ts'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1141:15)`
}

const options = { locale: 'zh-CN', logPath: '~/Library/Application Support/MacroBay/logs/app.log' }

describe('boot failure page', () => {
  it('renders both languages from a built-in dictionary instead of platformText', () => {
    const zh = renderBootFailurePage(failure, options)
    const en = renderBootFailurePage(failure, { ...options, locale: 'en-US' })

    expect(zh).toContain('应用未能启动')
    expect(zh).toContain('产品模块「market-intelligence」未能注册')
    expect(en).toContain('The app could not start')
    // 内置字典，不是 platformText：这个页面在 i18n 表挂掉时也必须能显示。
    expect(zh).not.toContain('platformText')
  })

  it('keeps the error code outside the truncated reason block', () => {
    const html = renderBootFailurePage(failure, options)
    const reasonBlock = html.slice(html.indexOf('class="reason"'), html.indexOf('class="code-row"'))
    const codeBlock = html.slice(html.indexOf('class="code-row"'), html.indexOf('<details'))

    // 裁断只可能裁掉机器话的尾部；用户先看到「哪个产品、什么码」。
    expect(reasonBlock).not.toContain('product-bootstrap-failed')
    expect(codeBlock).toContain('product-bootstrap-failed')
  })

  it('shows the anchored reason and keeps the raw path only inside the details block', () => {
    const html = renderBootFailurePage(failure, options)
    const body = html.slice(html.indexOf('<main'))
    const details = body.slice(body.indexOf('<details'))

    expect(body).toContain('…/products/market-intelligence/product.manifest.ts')
    // 技术详情里也是脱敏后的日志视图；屏幕上不出现 /Users/<名>。
    expect(body).not.toContain('/Users/alice')
    expect(details).toContain('Cannot find module')
  })

  it('loads nothing external: no theme file, no i18n bundle, no network', () => {
    const html = renderBootFailurePage(failure, options)
    expect(html).not.toMatch(/<script/u)
    expect(html).not.toMatch(/https?:/u)
    expect(html).not.toMatch(/<link/u)
    expect(html).not.toMatch(/src=/u)
    // 只跟系统偏好走，不读应用主题。
    expect(html).toContain('prefers-color-scheme')
  })

  it('offers exactly the three approved actions and rejects anything else', () => {
    const html = renderBootFailurePage(failure, options)
    expect(html).toContain('macrobay-boot:retry')
    expect(html).toContain('macrobay-boot:logs')
    expect(html).toContain('macrobay-boot:quit')

    expect(resolveBootFailureAction('macrobay-boot:retry')).toBe('retry')
    expect(resolveBootFailureAction('macrobay-boot:logs')).toBe('logs')
    expect(resolveBootFailureAction('macrobay-boot:quit')).toBe('quit')
    expect(resolveBootFailureAction('macrobay-boot:delete-everything')).toBeNull()
    expect(resolveBootFailureAction('https://example.com')).toBeNull()
  })

  it('formats the log path with a home placeholder on every platform', () => {
    const directory = '/Users/alice/Library/Application Support/MacroBay/logs'
    expect(formatBootFailureLogPath('darwin', directory)).toBe('~/Library/Application Support/MacroBay/logs/app.log')
    expect(formatBootFailureLogPath('win32', 'C:\\Users\\carol\\AppData\\Roaming\\MacroBay\\logs'))
      .toBe('%APPDATA%\\MacroBay\\logs\\app.log')
    expect(formatBootFailureLogPath('linux', '/home/bob/.config/MacroBay/logs')).toBe('~/.config/MacroBay/logs/app.log')
  })

  it('never shows an absolute home directory, even when product id is unknown', () => {
    const html = renderBootFailurePage({ ...failure, productId: null }, options)
    expect(html).toContain('应用停在了启动阶段')
    expect(html).not.toContain('/Users/')
    expect(html).toContain('~/Library/Application Support/MacroBay/logs/app.log')
  })
})
