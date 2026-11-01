import { describe, expect, it } from 'vitest'

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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

  it('gives the technical details their own visual boundary', () => {
    const html = renderBootFailurePage(failure, options)
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    const preRule = style.slice(style.indexOf('pre {'), style.indexOf('}', style.indexOf('pre {')))

    // 这一页的价值是让人在截图里指出「问题在哪」；没有边界，技术信息和我们写的说明就分不开。
    expect(preRule).toContain('border:1px solid var(--line)')
    expect(preRule).toContain('background:var(--bg)')
    expect(preRule).toContain('padding:8px')
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

  it('breaks long text at spaces before splitting a file name, everywhere it can wrap', () => {
    const html = renderBootFailurePage(failure, options)
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))

    // `break-all` 会在 `app.log` 中间断行，文件名被劈开。只改日志行没用：
    // 正文原因行与 `pre` 里的长路径同样会被劈开，所以整页不许出现 `break-all`。
    expect(style).not.toContain('break-all')
    expect(style.match(/overflow-wrap:anywhere/gu)?.length).toBe(3)
  })

  it('shrinks below 472px instead of clipping the actions', () => {
    const html = renderBootFailurePage(failure, options)
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    const cardRule = style.slice(style.indexOf('.card {'), style.indexOf('}', style.indexOf('.card {')))

    // 固定 472px 在窄窗里会把「退出应用」裁掉一半——而白屏时那正是用户最想按的键。
    expect(cardRule).toContain('max-width:472px')
    expect(cardRule).toContain('width:100%')
    // flex 子项的 min-width:auto 会让卡片撑到内容最小宽度，`width:100%` 也压不住。
    // 只断言「不再是固定宽度」：`max-width:472px` 里也含 `width:472px` 这个子串，用 toContain 会误判。
    expect(cardRule).not.toMatch(/(?:^|[^-\s])width:472px/u)
  })

  it('lets only this module turn failure text into markup', () => {
    // 脱敏发生在 failurePresentation，页面是它唯一的消费者。这条知识不能只存在人脑里：
    // 任何别的文件开始自己拼 HTML，就意味着它可能把 failure.reason（原文）直接插进去。
    const directory = __dirname
    const offenders = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.') && name !== 'bootFailurePage.ts')
      .filter((name) => {
        const source = readFileSync(join(directory, name), 'utf8')
        return source.includes('escapeHtml(') || source.includes('<!doctype html>') || source.includes('<div ')
      })

    expect(offenders).toEqual([])
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
