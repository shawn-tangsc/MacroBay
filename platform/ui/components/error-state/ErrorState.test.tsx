import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ErrorState, type ErrorStateProps } from './ErrorState'

const here = __dirname
const source = readFileSync(join(here, 'ErrorState.tsx'), 'utf8')
const css = readFileSync(join(here, 'errorState.css'), 'utf8')

describe('ErrorState', () => {
  it('renders title, description and one recovery action', () => {
    const onRetry = vi.fn()
    const markup = renderToStaticMarkup(
      <ErrorState
        title="Could not load providers"
        description="Your data is unchanged."
        recovery={{ kind: 'retry', label: 'Try again', onRetry }}
      />
    )

    expect(markup).toContain('<strong>Could not load providers</strong>')
    expect(markup).toContain('<span>Your data is unchanged.</span>')
    expect(markup).toContain('<button type="button" class="error-state-action">Try again</button>')
    expect(markup).toContain('data-variant="error"')
  })

  it('never renders a bare "please retry later" without an action', () => {
    // 契约用判别联合逼住这件事：recovery 必填，所以每一次错态都有一条出路。
    const markup = renderToStaticMarkup(
      <ErrorState
        title="Could not read"
        recovery={{ kind: 'none', reason: 'The file was removed by another program.' }}
      />
    )

    expect(markup).toContain('data-error-state-no-recovery')
    expect(markup).not.toContain('<button')
  })

  it('shows the unclear reason only in the unknown variant, with a question glyph', () => {
    const markup = renderToStaticMarkup(
      <ErrorState
        variant="unknown"
        title="Temporarily unreadable"
        unclearReason="The transport closed before the reply arrived."
        recovery={{ kind: 'retry', label: 'Retry', onRetry: () => undefined }}
      />
    )

    expect(markup).toContain('data-variant="unknown"')
    expect(markup).toContain('data-error-state-unclear')
    expect(markup).toContain('The transport closed before the reply arrived.')
    // 形状不同才是「不靠颜色也能分辨」的证据：这里断言真实渲染出的图标，不读 CSS。
    expect(markup).toContain('lucide-circle-question-mark')
  })

  it('draws a different glyph for a known error than for an unknown one', () => {
    const known = renderToStaticMarkup(
      <ErrorState title="Failed" recovery={{ kind: 'retry', label: 'Retry', onRetry: () => undefined }} />
    )
    const unknown = renderToStaticMarkup(
      <ErrorState
        variant="unknown"
        title="Unreadable"
        unclearReason="No reason available."
        recovery={{ kind: 'retry', label: 'Retry', onRetry: () => undefined }}
      />
    )

    expect(known).toContain('lucide-triangle-alert')
    expect(unknown).toContain('lucide-circle-question-mark')
    expect(unknown).not.toContain('lucide-triangle-alert')
  })

  it('declares a non-danger palette for the unknown variant (rule exists in CSS)', () => {
    // 这条只证明「样式里有这条规则」，不证明渲染结果；渲染由上面两条用真实图标断言。
    expect(css).toContain("[data-variant='unknown']")
    expect(css).toContain('--muted-strong')
  })

  it('keeps details collapsed until the reader opens them', () => {
    const markup = renderToStaticMarkup(
      <ErrorState
        title="Failed"
        details={{ summary: 'Technical details', body: 'stack line 1\nstack line 2' }}
        recovery={{ kind: 'alternative', label: 'Open logs', onGo: () => undefined }}
      />
    )

    expect(markup).toContain('<details>')
    expect(markup).toContain('<summary>Technical details</summary>')
  })

  it('holds no copy of its own and no second loading implementation', () => {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(withoutComments).not.toMatch(/[\u4e00-\u9fa5]/)
    expect(source).not.toMatch(/setInterval|spin|rotate|Loading/i)
    expect(css).not.toMatch(/var\([^)]*,\s*#/)
  })
})

/**
 * 编译期契约：unknown 支缺 `unclearReason`、或给它一个非 retry 的 recovery，都必须编译不过；
 * `title` / `recovery` 缺失同理。`variant` 默认是 error，所以「想写 unknown」必须显式声明。
 */
export function errorStateTypeContract(): void {
  // @ts-expect-error title 必填
  const missingTitle: ErrorStateProps = { recovery: { kind: 'retry', label: 'Again', onRetry: () => undefined } }
  // @ts-expect-error recovery 必填
  const missingRecovery: ErrorStateProps = { title: 'Broken' }
  // @ts-expect-error unknown 支必须带 unclearReason
  const unknownWithoutReason: ErrorStateProps = {
    variant: 'unknown',
    title: 'Temporarily unreadable',
    recovery: { kind: 'retry', label: 'Retry', onRetry: () => undefined }
  }
  // @ts-expect-error unknown 支只接受 retry，不接受 alternative
  const unknownWithAlternative: ErrorStateProps = {
    variant: 'unknown',
    title: 'Temporarily unreadable',
    unclearReason: 'Unknown failure.',
    recovery: { kind: 'alternative', label: 'Open logs', onGo: () => undefined }
  }
  void missingTitle
  void missingRecovery
  void unknownWithoutReason
  void unknownWithAlternative
}
