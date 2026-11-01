// @vitest-environment happy-dom

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { StateView, type StateViewProps } from './StateView'

const source = readFileSync(join(__dirname, 'StateView.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'stateView.css'), 'utf8')

/** 测试只证明「键被解析」，不替调用方造句：透传即把键当句子。 */
const key = (value: string): string => value

function mount(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  return host
}

describe('StateView', () => {
  it('renders children and nothing else for `normal`', () => {
    const markup = renderToStaticMarkup(
      <StateView state="normal" resolveText={key}>
        <p data-child />
      </StateView>
    )

    // 不套壳、不留标题/原因/动作的位置：多一层包裹，迁移当天就多一份间距。
    expect(markup).toBe('<p data-child="true"></p>')
  })

  it('renders the shared LoadingState for `loading`, with one live region and no local spinner', () => {
    const host = mount(renderToStaticMarkup(<StateView state="loading" resolveText={key} />))

    // 复用要在 DOM 上查得到：截图分不出「复用」和「照抄一遍」。
    expect(host.querySelector('[data-loading-state]')).not.toBeNull()
    expect(host.innerHTML).toContain('class="loading-state loading-state--block"')
    expect(host.innerHTML).toContain('ui.state.loading')
    // 第 262 行：loading 只许有一处 live region，且必须是 LoadingState 自己的。
    expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(css).not.toMatch(/@keyframes|rotate\(\s*360deg/)
    expect(source).not.toMatch(/@keyframes|rotate\(/)
  })

  it('renders icon + title + reason + one action for `empty`, without announcing it', () => {
    const host = mount(
      renderToStaticMarkup(
        <StateView
          state="empty"
          reasonCode="no-source"
          resolveText={key}
          action={{ labelKey: 'ui.action.open-settings', onSelect: () => undefined }}
        />
      )
    )

    expect(host.querySelector('[data-state-icon="empty"]')).not.toBeNull()
    expect(host.textContent).toContain('ui.state.empty')
    expect(host.textContent).toContain('ui.state.empty.reason.no-source')
    // empty 不进 live region：常驻说明不是事件，出现即播报会抢读屏。
    expect(host.querySelector('[aria-live]')).toBeNull()
    expect(host.querySelector('[role]')).toBeNull()
    expect(host.querySelector('button')?.textContent).toBe('ui.action.open-settings')
  })

  it('announces only `error`, politely, and keeps details and the action outside the live region', () => {
    const host = mount(
      renderToStaticMarkup(
        <StateView
          state="error"
          reasonCode="unreachable"
          resolveText={key}
          details={{ summaryKey: 'ui.error.details.summary', bodyKey: 'ui.error.details.body' }}
          action={{ labelKey: 'ui.action.retry', onSelect: () => undefined }}
        />
      )
    )

    const live = host.querySelector('.state-view__live')
    expect(live?.getAttribute('role')).toBe('status')
    expect(live?.getAttribute('aria-live')).toBe('polite')
    // 不是 alert：assertive 会打断朗读，还会把按钮一起念出来。
    expect(host.innerHTML).not.toContain('role="alert"')
    // live region 只包标题与原因；详情与按钮在它外面。
    expect(live?.querySelector('button')).toBeNull()
    expect(live?.querySelector('details')).toBeNull()
    expect(live?.textContent).toContain('ui.state.error')
    expect(live?.textContent).toContain('ui.state.error.reason.unreachable')
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(host.querySelector('summary')?.textContent).toBe('ui.error.details.summary')
    expect(host.querySelector('details p')?.textContent).toBe('ui.error.details.body')
  })

  it('shows no action row at all for `permission` when the action is omitted', () => {
    const host = mount(
      renderToStaticMarkup(<StateView state="permission" reasonCode="admin-only" resolveText={key} />)
    )

    // 不渲染包裹元素、不留空位：不是 visibility:hidden，也不是一个空 div。
    expect(host.querySelector('button')).toBeNull()
    expect(host.innerHTML).not.toContain('state-view__action')
    expect(host.textContent).toContain('ui.state.permission')
    expect(host.textContent).toContain('ui.state.permission.reason.admin-only')
    expect(host.querySelector('[aria-live]')).toBeNull()
  })

  it('keeps `disabled` and `permission` apart without colour: different outline, different action slot', () => {
    const disabled = mount(
      renderToStaticMarkup(
        <StateView
          state="disabled"
          reasonCode="turned-off"
          resolveText={key}
          action={{ labelKey: 'ui.action.open-settings', onSelect: () => undefined }}
        />
      )
    )
    const permission = mount(
      renderToStaticMarkup(<StateView state="permission" reasonCode="admin-only" resolveText={key} />)
    )

    // ① 图标轮廓不同：圈加斜杠 vs 锁，不是同一形状换颜色。
    expect(disabled.querySelector('[data-state-icon="disabled"]')).not.toBeNull()
    expect(disabled.innerHTML).toContain('M5.6 5.6l12.8 12.8')
    expect(permission.querySelector('[data-state-icon="permission"]')).not.toBeNull()
    expect(permission.innerHTML).toContain('<rect x="4" y="11"')
    // ② 动作位不同：禁用必须留一个点得动的动作，权限不给主按钮。
    expect(disabled.querySelector('button')).not.toBeNull()
    expect(permission.querySelector('button')).toBeNull()
    // ③ 两态同色：区分不靠颜色，只靠上面两条。
    expect(css).not.toMatch(/\.state-view--disabled[^{]*\{[^}]*color:/)
  })

  it('picks the icon from `state` alone, not from the reason code', () => {
    const iconOf = (markup: string): string => {
      const host = mount(markup)
      return host.querySelector('[data-state-icon]')?.outerHTML ?? ''
    }

    const first = iconOf(renderToStaticMarkup(<StateView state="empty" reasonCode="no-source" resolveText={key} />))
    const second = iconOf(
      renderToStaticMarkup(<StateView state="empty" reasonCode="filtered-out" resolveText={key} />)
    )

    expect(first).toBe(second)
    expect(first).toContain('data-state-icon="empty"')
  })

  it('measures the two heights the spec names: 220 for a page, 80 inside a card', () => {
    const page = mount(
      renderToStaticMarkup(<StateView state="empty" reasonCode="no-source" resolveText={key} size="lg" />)
    )
    const card = mount(renderToStaticMarkup(<StateView state="empty" reasonCode="no-source" resolveText={key} />))

    // 量出来的值，不是「看起来差不多」：读的就是提交给浏览器的 min-height。
    expect(page.querySelector<HTMLElement>('.state-view')?.style.minHeight).toBe('220px')
    expect(card.querySelector<HTMLElement>('.state-view')?.style.minHeight).toBe('80px')
    expect(page.querySelector('.state-view')?.getAttribute('data-size')).toBe('lg')
    expect(card.querySelector('.state-view')?.getAttribute('data-size')).toBe('md')
  })

  it('applies the same two heights to `loading`, through LoadingState', () => {
    const page = mount(renderToStaticMarkup(<StateView state="loading" resolveText={key} size="lg" />))
    const card = mount(renderToStaticMarkup(<StateView state="loading" resolveText={key} />))

    expect(page.querySelector<HTMLElement>('[data-loading-state]')?.style.minHeight).toBe('220px')
    expect(card.querySelector<HTMLElement>('[data-loading-state]')?.style.minHeight).toBe('80px')
  })

  it('holds no copy of its own, no icon prop and no semantic switch', () => {
    // 只允许注释里出现中文说明；JSX 与字符串里不许有文案。
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(withoutComments).not.toMatch(/[\u4e00-\u9fa5]/)
    expect(source).not.toMatch(/\bicon\s*[:?]/)
    expect(source).not.toMatch(/spinner/i)
    expect(source).not.toMatch(/setInterval|rotate/i)
    // 兜底色不许出现在调用点：默认值归 tokens.css 一处。
    expect(css).not.toMatch(/var\([^)]*,\s*#/)
  })

  it('never lets a call site pick the inline `sm` size in this batch', () => {
    const repoRoot = resolve(__dirname, '../../../..')
    const roots = ['apps/desktop-shell/src/renderer/src', 'products', 'platform']

    const offenders: string[] = []
    for (const root of roots) {
      for (const file of walk(resolve(repoRoot, root), ['.tsx', '.ts'])) {
        if (/\.test\.(ts|tsx)$/.test(file)) continue
        const text = readFileSync(file, 'utf8')
        if (!/<\/?StateView/.test(text)) continue
        if (/<StateView[\s\S]{0,400}?size=["']sm["']/.test(text)) offenders.push(file)
      }
    }

    // `sm` 的类型保留（尺寸词只有一份），但这一批不许有调用点开它；开之前先等行内图。
    expect(offenders).toEqual([])
  })
})

function walk(root: string, extensions: readonly string[]): string[] {
  const found: string[] = []
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, extensions))
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path)
  }
  return found
}

/**
 * 编译期契约：这几行什么都不做，价值是让 tsc 校验 `@ts-expect-error`。
 * 谁把 `reasonCode` 改回可选、把 `disabled` 的 `action` 放开、或给 props 加回 `icon`，这里先红。
 */
export function stateViewTypeContract(): void {
  const text = (value: string): string => value

  // @ts-expect-error normal 必须带 children
  const normalWithoutChildren: StateViewProps = { state: 'normal', resolveText: text }
  // @ts-expect-error empty 缺 reasonCode 编译不过（不收自由文案，也不落兜底句）
  const emptyWithoutReason: StateViewProps = { state: 'empty', resolveText: text }
  // @ts-expect-error 只收 reasonCode，不收 reason: string
  const emptyWithFreeText: StateViewProps = { state: 'empty', reason: 'x', resolveText: text }
  // @ts-expect-error disabled 必须带 action：禁用态要留一个点了就能解决的动作
  const disabledWithoutAction: StateViewProps = { state: 'disabled', reasonCode: 'turned-off', resolveText: text }
  // @ts-expect-error 不收 icon：图标由组件内一张表按 state 决定
  const withIcon: StateViewProps = { state: 'empty', reasonCode: 'no-source', resolveText: text, icon: 'x' }
  // @ts-expect-error 不收 spinner 这类语义开关
  const withSpinner: StateViewProps = { state: 'loading', resolveText: text, spinner: true }
  // @ts-expect-error size 只允许 sm | md | lg
  const withPageSize: StateViewProps = { state: 'empty', reasonCode: 'no-source', resolveText: text, size: 'page' }
  // @ts-expect-error 不收 title 字面量
  const withTitle: StateViewProps = { state: 'empty', reasonCode: 'no-source', resolveText: text, title: 'x' }

  void normalWithoutChildren
  void emptyWithoutReason
  void emptyWithFreeText
  void disabledWithoutAction
  void withIcon
  void withSpinner
  void withPageSize
  void withTitle
}
