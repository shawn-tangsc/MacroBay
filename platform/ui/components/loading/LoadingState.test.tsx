import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LoadingSpinner, LoadingState } from './LoadingState'

function markup(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
}

describe('LoadingState', () => {
  it('renders one centered status region with a spinning ring and the wait copy', () => {
    const html = markup(<LoadingState label="加载中" />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('data-loading-state')
    expect(html).toContain('loading-state--block')
    expect(html).toContain('loading-spinner--md')
    expect(html).toContain('加载中')
  })

  it('keeps the ring out of the accessibility tree and names the region once', () => {
    const html = markup(<LoadingState label="正在加载数据" />)

    expect(html.match(/aria-hidden="true"/g)).toHaveLength(1)
    // The visible copy already names the wait; a second aria-label would repeat it.
    expect(html).not.toContain('aria-label=')
  })

  it('gives an unnamed ring-only state an accessible name', () => {
    const html = markup(<LoadingState ariaLabel="加载中" size="lg" />)

    expect(html).toContain('aria-label="加载中"')
    expect(html).toContain('loading-spinner--lg')
    expect(html).not.toContain('loading-state__label')
  })

  it('renders inline as a span so it can sit inside a status bar', () => {
    const html = markup(<LoadingState layout="inline" label="同步中" size="sm" />)

    expect(html.startsWith('<span')).toBe(true)
    expect(html).toContain('loading-state--inline')
    expect(html).toContain('loading-spinner--sm')
  })

  it('fills a region that owns its height instead of reserving a minimum', () => {
    const html = markup(<LoadingState label="加载中" fill minHeight={320} />)

    expect(html).toContain('loading-state--fill')
    expect(html).not.toContain('min-height')
  })

  it('honors an explicit block height for a short drawer body', () => {
    const html = markup(<LoadingState label="加载中" minHeight={180} />)

    expect(html).toContain('min-height:180px')
    expect(html).not.toContain('loading-state--fill')
  })

  it('passes the caller class through for region-specific layout', () => {
    const html = markup(<LoadingState label="加载中" className="mi-panel__loading" />)

    expect(html).toContain('loading-state loading-state--block mi-panel__loading')
  })
})

describe('LoadingSpinner', () => {
  it('is decorative on its own, because the host control carries the name', () => {
    const html = markup(<LoadingSpinner size="sm" className="model-service-pill__spinner" />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('loading-spinner loading-spinner--sm model-service-pill__spinner')
    expect(html).not.toContain('role="status"')
  })

  it('stops the ring under reduced motion instead of only slowing it down', () => {
    // 「慢转」仍然在转；规范要的是**静止的弧**。弧来自 border-top-color，停掉动画不会让它消失。
    const css = readFileSync(join(__dirname, 'loadingState.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? ''
    expect(block).toContain('animation: none')
    expect(block).not.toMatch(/animation-duration/u)
  })
})
