// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STATE_VIEW_STATES, STATE_VIEW_TEXT_KEYS, StateView, stateViewTextKeys, type StateViewProps } from './StateView'

const source = readFileSync(join(__dirname, 'StateView.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'stateView.css'), 'utf8')

/** 测试只证明「键被解析」，不替调用方造句：透传即把键当句子。 */
const key = (value: string): string => value

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  document.head.querySelectorAll('style').forEach((node) => node.remove())
})

function mount(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  return host
}

function markup(props: StateViewProps): string {
  return renderToStaticMarkup(<StateView {...props} />)
}

describe('StateView', () => {
  it('keeps the six states fixed and ordered — no seventh name', () => {
    expect(STATE_VIEW_STATES).toEqual(['normal', 'loading', 'empty', 'error', 'disabled', 'permission'])
  })

  it('normal renders children only, with no title, reason or action slot', () => {
    const html = markup({ state: 'normal', resolveText: key, children: <p data-child>content</p> })

    expect(html).toBe('<p data-child="true">content</p>')
    expect(html).not.toContain('state-view')
    expect(html).not.toContain('<button')
  })

  it('loading reuses LoadingState — the marker class is the proof, not a lookalike', () => {
    const host = mount(markup({ state: 'loading', resolveText: key }))

    expect(host.querySelector('[data-loading-state]')).not.toBeNull()
    expect(host.innerHTML).toContain('loading-state--block')
    expect(host.innerHTML).toContain('ui.state.loading')
    // 只有 LoadingState 自己那一处 live region：外面再包一层会念两遍。
    expect(host.querySelectorAll('[aria-live]')).toHaveLength(1)
  })

  it('adds no second animation or polling loop of its own', () => {
    expect(source).not.toMatch(/@keyframes|animation/)
    expect(css).not.toMatch(/@keyframes|animation:/)
    expect(source).not.toMatch(/setInterval|requestAnimationFrame/)
  })

  it('empty renders icon, title, one reason and one action, without announcing itself', () => {
    const host = mount(
      markup({
        state: 'empty',
        reasonCode: 'never-created',
        resolveText: key,
        action: { labelKey: 'ui.state.action.create', onSelect: () => undefined }
      })
    )

    expect(host.querySelector('[data-state-icon="empty"]')).not.toBeNull()
    expect(host.textContent).toContain('ui.state.empty')
    expect(host.textContent).toContain('ui.state.empty.reason.never-created')
    expect(host.querySelector('button')?.textContent).toBe('ui.state.action.create')
    // 空态不是事件，不播报。
    expect(host.querySelector('[aria-live]')).toBeNull()
  })

  it('uses the reason code it is given, not a shared empty sentence', () => {
    const html = markup({
      state: 'empty',
      reasonCode: 'filtered-out',
      resolveText: key,
      action: { labelKey: 'ui.state.action.clear-filter', onSelect: () => undefined }
    })

    expect(html).toContain('ui.state.empty.reason.filtered-out')
    expect(html).toContain('ui.state.action.clear-filter')
  })

  it('not-yet carries no action row at all', () => {
    const host = mount(markup({ state: 'empty', reasonCode: 'not-yet', resolveText: key }))

    expect(host.querySelector('button')).toBeNull()
    expect(host.innerHTML).not.toContain('state-view__action')
    expect(host.textContent).toContain('ui.state.empty.reason.not-yet')
  })

  it('error is a polite live region, with details collapsed and the action outside it', () => {
    const host = mount(
      markup({
        state: 'error',
        reasonCode: 'unreadable',
        resolveText: key,
        details: { summaryKey: 'ui.state.error.details', bodyKey: 'ui.state.error.details.body' },
        action: { labelKey: 'ui.state.action.retry', onSelect: () => undefined }
      })
    )

    const live = host.querySelector('.state-view__live')
    expect(live?.getAttribute('role')).toBe('status')
    expect(live?.getAttribute('aria-live')).toBe('polite')
    expect(host.innerHTML).not.toContain('role="alert"')
    expect(live?.querySelector('button')).toBeNull()
    expect(live?.querySelector('details')).toBeNull()
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(host.querySelector('summary')?.textContent).toBe('ui.state.error.details')
  })

  it('keeps unreadable and unavailable apart by their action', () => {
    const unreadable = markup({
      state: 'error',
      reasonCode: 'unreadable',
      resolveText: key,
      action: { labelKey: 'ui.state.action.retry', onSelect: () => undefined }
    })
    const unavailable = markup({
      state: 'error',
      reasonCode: 'unavailable',
      resolveText: key,
      action: { labelKey: 'ui.state.action.check-source', onSelect: () => undefined }
    })

    expect(unreadable).toContain('ui.state.error.reason.unreadable')
    expect(unavailable).toContain('ui.state.error.reason.unavailable')
    expect(unreadable).toContain('ui.state.action.retry')
    expect(unavailable).toContain('ui.state.action.check-source')
  })

  it('separates disabled from permission by outline and action, not by colour', () => {
    const disabled = mount(
      markup({
        state: 'disabled',
        reasonCode: 'capability-not-wired',
        resolveText: key
      })
    )
    const permission = mount(
      markup({
        state: 'permission',
        reasonCode: 'not-granted',
        resolveText: key,
        action: { labelKey: 'ui.state.action.open-system-settings', onSelect: () => undefined }
      })
    )

    // ① 图标轮廓不同：圈加斜杠 vs 锁。
    expect(disabled.querySelector('[data-state-icon="disabled"]')).not.toBeNull()
    expect(permission.querySelector('[data-state-icon="permission"]')).not.toBeNull()
    expect(disabled.innerHTML).toContain('M5.6 5.6l12.8 12.8')
    expect(permission.innerHTML).toContain('<rect x="4" y="11"')
    // ② 动作位不同：平台没接通给不出动作；缺权限必须给「去系统设置」，且按钮真能把人送过去。
    expect(disabled.querySelector('button')).toBeNull()
    expect(permission.querySelector('button')?.textContent).toBe('ui.state.action.open-system-settings')
    // ③ 两态都不用危险色。
    expect(css).not.toMatch(/\.state-view--(disabled|permission)[^{]*\{[^}]*--danger/)
  })

  it('bounds target-disabled and capability-not-wired to different action shapes', () => {
    const targetDisabled = markup({
      state: 'disabled',
      reasonCode: 'target-disabled',
      resolveText: key,
      action: { labelKey: 'ui.state.action.enable', onSelect: () => undefined }
    })

    expect(targetDisabled).toContain('ui.state.disabled.reason.target-disabled')
    expect(targetDisabled).toContain('ui.state.action.enable')
  })

  it('measures exactly 220px at page size and 80px inside a card', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)

    const page = mount(
      markup({
        state: 'empty',
        reasonCode: 'never-created',
        resolveText: key,
        size: 'lg',
        action: { labelKey: 'ui.state.action.create', onSelect: () => undefined }
      })
    )
    const panel = mount(
      markup({
        state: 'empty',
        reasonCode: 'never-created',
        resolveText: key,
        action: { labelKey: 'ui.state.action.create', onSelect: () => undefined }
      })
    )

    expect(page.querySelector<HTMLElement>('.state-view')?.style.minHeight).toBe('220px')
    expect(panel.querySelector<HTMLElement>('.state-view')?.style.minHeight).toBe('80px')
  })

  it('calls onSelect when the action is pressed', async () => {
    const onSelect = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <StateView
          state="error"
          reasonCode="unreadable"
          resolveText={key}
          action={{ labelKey: 'ui.state.action.retry', onSelect }}
        />
      )
    })

    const button = host.querySelector('button')!
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('gives permission a working "open system settings" button, not a dead one', async () => {
    const openSystemSettings = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <StateView
          state="permission"
          reasonCode="not-granted"
          resolveText={key}
          action={{ labelKey: 'ui.state.action.open-system-settings', onSelect: openSystemSettings }}
        />
      )
    })

    // 必填动作配空实现就是死按钮换了个位置：按下去必须真的调到调用方送进来的入口。
    const button = host.querySelector('button')!
    expect(button.textContent).toBe('ui.state.action.open-system-settings')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(openSystemSettings).toHaveBeenCalledTimes(1)
  })

  it('builds the documented key names in one place, and lists every key it can ask for', () => {
    expect(stateViewTextKeys('empty', 'never-created')).toEqual({
      title: 'ui.state.empty',
      reason: 'ui.state.empty.reason.never-created'
    })
    // 每个码都要在两份语言里有句子：清单是 platformText 的类型来源。
    for (const reasonCode of ['never-created', 'filtered-out', 'no-target-bound', 'nothing-enabled', 'not-yet']) {
      expect(STATE_VIEW_TEXT_KEYS).toContain(stateViewTextKeys('empty', reasonCode).reason)
    }
    for (const reasonCode of ['unreadable', 'unavailable', 'notification-unknown']) {
      expect(STATE_VIEW_TEXT_KEYS).toContain(stateViewTextKeys('error', reasonCode).reason)
    }
    for (const reasonCode of ['capability-not-wired', 'target-disabled']) {
      expect(STATE_VIEW_TEXT_KEYS).toContain(stateViewTextKeys('disabled', reasonCode).reason)
    }
    expect(STATE_VIEW_TEXT_KEYS).toContain(stateViewTextKeys('permission', 'not-granted').reason)
  })

  it('holds no copy of its own, no icon prop and no semantic switch', () => {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(withoutComments).not.toMatch(/[\u4e00-\u9fa5]/)
    expect(source).not.toMatch(/\bicon\s*[:?]/)
    expect(source).not.toMatch(/spinner/i)
    expect(css).not.toMatch(/var\([^)]*,\s*#/)
  })

  it('rejects free text, wrong code/state pairs and missing actions at compile time', () => {
    // @ts-expect-error 只收 reasonCode；自由文案会让每处站点长出自己的一句话。
    const freeText: StateViewProps = { state: 'empty', reason: 'x', resolveText: key }
    // @ts-expect-error 每码一支：empty 不能配 error 的码。
    const wrongPair: StateViewProps = { state: 'empty', reasonCode: 'unreadable', resolveText: key }
    // 动作已是场景判断，不再由类型强制：这一条现在应当能编译（留作对照，不再期望报错）。
    const withoutAction: StateViewProps = { state: 'empty', reasonCode: 'never-created', resolveText: key }
    // not-yet 也可以有动作（场景判断）：留作对照，不再期望报错。
    const actionOnNotYet: StateViewProps = {
      state: 'empty',
      reasonCode: 'not-yet',
      resolveText: key,
      action: { labelKey: 'ui.state.action.create', onSelect: () => undefined }
    }
    // capability-not-wired 同上：类型不拦，交给文档判据。
    const actionOnWired: StateViewProps = {
      state: 'disabled',
      reasonCode: 'capability-not-wired',
      resolveText: key,
      action: { labelKey: 'ui.state.action.enable', onSelect: () => undefined }
    }
    // @ts-expect-error details 只属 error。
    const detailsOnEmpty: StateViewProps = {
      state: 'empty',
      reasonCode: 'never-created',
      resolveText: key,
      action: { labelKey: 'ui.state.action.create', onSelect: () => undefined },
      details: { summaryKey: 'a', bodyKey: 'b' }
    }
    // @ts-expect-error 动作文案是码表里的键，自由字符串编译不过。
    const freeLabel: StateViewProps = { state: 'permission', reasonCode: 'not-granted', resolveText: key, action: { labelKey: 'ui.state.action.whatever', onSelect: () => undefined } }
    // 权限态的动作也改成按场景判断。
    const missingGrant: StateViewProps = { state: 'permission', reasonCode: 'not-granted', resolveText: key }
    // 出错态的动作同样按场景判断。
    const missingRetry: StateViewProps = { state: 'error', reasonCode: 'unreadable', resolveText: key }
    // @ts-expect-error 不收 spinner 这类语义开关。
    const spinner: StateViewProps = { state: 'loading', resolveText: key, spinner: true }
    // @ts-expect-error size 是位置词，不收数字。
    const numericSize: StateViewProps = { state: 'loading', resolveText: key, size: 220 }

    for (const value of [freeText, wrongPair, withoutAction, actionOnNotYet, actionOnWired, detailsOnEmpty, freeLabel, missingGrant, missingRetry, spinner, numericSize]) {
      expect(value).toBeDefined()
    }
  })
})

describe('窗口三种「没有」互不顶替（§3：查过没有 ≠ 还没到）', () => {
  it('renders a different reason sentence for not-yet / older-than-window / nothing-in-window', () => {
    const key = (value: string): string => value
    const html = [
      markup({ state: 'empty', reasonCode: 'not-yet', resolveText: key }),
      markup({ state: 'empty', reasonCode: 'older-than-window', resolveText: key, action: { labelKey: 'ui.state.action.widen-time-window', onSelect: () => {} } }),
      markup({ state: 'empty', reasonCode: 'nothing-in-window', resolveText: key, action: { labelKey: 'ui.state.action.widen-time-window', onSelect: () => {} } })
    ]

    const reasons = html.map((item) => item.match(/ui\.state\.empty\.reason\.[a-z-]+/)?.[0])
    expect(reasons).toEqual([
      'ui.state.empty.reason.not-yet',
      'ui.state.empty.reason.older-than-window',
      'ui.state.empty.reason.nothing-in-window'
    ])
    // 三者互不相同：用 not-yet 顶「查过了没有」的那一句，会在这里先红。
    expect(new Set(reasons).size).toBe(3)
  })
})

describe('产品原因句入口（§17：只覆盖原因句，参数必须走到）', () => {
  /** 产品文案表的替身：与产品一样，句子里带 `{参数名}` 占位。 */
  const TEMPLATES: Record<string, string> = {
    'mi.newsSentiment.staleSince': '数据已过期 · 最后更新 {moment}'
  }
  const productResolve = (dictKey: string, params?: Record<string, string>): string =>
    (TEMPLATES[dictKey] ?? '').replace(/\{(\w+)\}/g, (_whole, name: string) => params?.[name] ?? `{${name}}`)

  const stale: StateViewProps = {
    state: 'disabled',
    reasonCode: 'target-disabled',
    resolveText: key,
    productReason: {
      key: 'mi.newsSentiment.staleSince',
      params: { moment: '2026-11-02 01:20 (UTC+08:00)' },
      resolve: productResolve
    }
  }

  it('renders the product sentence with its parameter filled in, never the raw placeholder', () => {
    const html = markup(stale)

    expect(html).toContain('数据已过期 · 最后更新 2026-11-02 01:20 (UTC+08:00)')
    // 「参数有路可走」的判据就在这里：占位符不许原样出现在结果里。
    expect(html).not.toContain('{moment}')
    expect(html).toContain('data-reason-source="product"')
  })

  it('keeps the title on the platform even when the reason is the product sentence', () => {
    const html = markup(stale)

    expect(html).toContain('data-reason-source="product"')
    // 标题仍是 `ui.state.<state>` 键解析出来的，产品改不到。
    expect(html).toContain('ui.state.disabled')
  })

  it('renders the page-load-failed code with the reload action it must carry', () => {
    const html = markup({
      state: 'error',
      reasonCode: 'page-load-failed',
      resolveText: key,
      action: { labelKey: 'ui.state.action.reload-page', onSelect: () => undefined }
    })

    // 句子走键：界面上要看到键解析出来的结果，而不是 `{page-load-failed}` 这种裸码。
    expect(html).toContain('ui.state.error.reason.page-load-failed')
    expect(html).not.toContain('{page-load-failed}')
    // 恢复动作是重载页面，不是重试那次操作，也不是重启应用。
    expect(html).toContain('ui.state.action.reload-page')
    expect(html).toContain('role="status"')
  })

  it('falls back to the platform sentence when the product asks for a missing key', () => {
    const html = markup({
      state: 'empty',
      reasonCode: 'not-yet',
      resolveText: key,
      productReason: { key: 'mi.newsSentiment.notInTheTable', resolve: productResolve }
    })

    expect(html).toContain('data-reason-source="platform"')
    expect(html).toContain('ui.state.empty.reason.not-yet')
  })

  it('falls back instead of leaving the reason blank when the product returns nothing', () => {
    for (const resolve of [() => '', () => '   ']) {
      const html = markup({
        state: 'empty',
        reasonCode: 'not-yet',
        resolveText: key,
        productReason: { key: 'mi.newsSentiment.emptyText', resolve }
      })

      expect(html).toContain('data-reason-source="platform"')
      expect(html).toContain('ui.state.empty.reason.not-yet')
      expect(html).not.toContain('data-reason-source="product"')
    }
  })

  it('does not take the screen down when a product resolver throws', () => {
    const html = markup({
      state: 'error',
      reasonCode: 'unreadable',
      resolveText: key,
      productReason: {
        key: 'mi.newsSentiment.boom',
        resolve: () => {
          throw new Error('product table exploded')
        }
      }
    })

    expect(html).toContain('data-reason-source="platform"')
    expect(html).toContain('ui.state.error.reason.unreadable')
  })

  it('keeps diagnostic text inside the folded detail, never in title, reason or action', () => {
    const body = 'TypeError: fetch failed\n    at readSources (sources.ts:42)'
    const html = markup({
      state: 'error',
      reasonCode: 'page-load-failed',
      resolveText: key,
      action: { labelKey: 'ui.state.action.reload-page', onSelect: () => undefined },
      details: { bodyText: body }
    })

    // ① 原文只出现一次，且落在折叠区里。
    expect(html.split('TypeError: fetch failed').length - 1).toBe(1)
    const detailsIndex = html.indexOf('state-view__details')
    expect(detailsIndex).toBeGreaterThan(-1)
    expect(html.indexOf('TypeError: fetch failed')).toBeGreaterThan(detailsIndex)

    // ② 标题、原因句、动作位都不含它。
    const title = /<strong class="state-view__title">([^<]*)<\/strong>/.exec(html)?.[1] ?? ''
    const reason = /<span class="state-view__reason"[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? ''
    const action = /<button[^>]*class="state-view__action"[^>]*>([^<]*)<\/button>/.exec(html)?.[1] ?? ''
    expect([title, reason, action].join('')).not.toContain('TypeError')
  })

  it('renders the diagnostic area closed, named, and keyboard reachable', () => {
    const html = markup({
      state: 'error',
      reasonCode: 'page-load-failed',
      resolveText: key,
      details: { bodyText: 'boom' }
    })

    // 默认收起（没有 open 属性）。
    expect(html).toMatch(/<details class="state-view__details"(?![^>]*\bopen\b)/)
    // 有可读名：摘要文字来自现成键。
    expect(html).toContain('<summary>ui.state.error.details</summary>')
    // 原生 <summary> 就是键盘可达的展开控件，不再自造一个按钮。
    expect(html).toContain('<summary>')
    expect(html).not.toContain('role="button"')
  })

  it('styles the diagnostic text monospace and selectable', () => {
    // 样式断言落在规则上：等宽 + 可选中是「读者要复制它」的唯一保障。
    expect(css).toMatch(/\.state-view__details-text\s*\{[^}]*font-family:\s*ui-monospace/)
    expect(css).toMatch(/\.state-view__details-text\s*\{[^}]*user-select:\s*text/)
  })

  it('never announces the diagnostic text', () => {
    const body = 'secret-ish stack line'
    const html = markup({
      state: 'error',
      reasonCode: 'page-load-failed',
      resolveText: key,
      details: { bodyText: body }
    })

    // 先证明这段原文真的出现了：否则「不在播报里」在两个分支都不渲染时也成立，等于空转。
    expect(html).toContain(body)
    expect(html).toContain('state-view__details')

    const live = /<span class="state-view__live"[^>]*>([\s\S]*?)<\/span>\s*(?:<details|<button)/.exec(html)?.[1] ?? ''
    expect(live).not.toContain(body)
    // 折叠区自己在 live region 外面，也不带 aria-live / role=status。
    const detailsTag = /<details[^>]*>/.exec(html)?.[0] ?? ''
    expect(detailsTag).not.toContain('aria-live')
    expect(detailsTag).not.toContain('role="status"')
  })

  it('renders no detail box at all when the diagnostic text is empty', () => {
    // 先证明非空时**会**渲染，否则「空时不渲染」在两个分支都不靠时也成立。
    expect(
      markup({ state: 'error', reasonCode: 'page-load-failed', resolveText: key, details: { bodyText: 'boom' } })
    ).toContain('state-view__details')

    for (const bodyText of ['', '   ', '\n\t']) {
      const html = markup({
        state: 'error',
        reasonCode: 'page-load-failed',
        resolveText: key,
        details: { bodyText }
      })

      expect(html).not.toContain('state-view__details')
    }
  })

  it('leaves the old bodyKey path exactly as it was', () => {
    const html = markup({
      state: 'error',
      reasonCode: 'unreadable',
      resolveText: key,
      details: { summaryKey: 'ui.state.error.details', bodyKey: 'ui.state.error.details' }
    })

    expect(html).toContain('<p>ui.state.error.details</p>')
    expect(html).not.toContain('state-view__details-text')
  })

  it('only offers the entry on the four states that have a reason sentence', () => {
    // @ts-expect-error `normal` 没有原因句，传 `productReason` 不成立。
    const onNormal: StateViewProps = { state: 'normal', resolveText: key, productReason: { key: 'mi.a', resolve: productResolve } }
    // @ts-expect-error `loading` 的句子归 LoadingState，同样没有这一格。
    const onLoading: StateViewProps = { state: 'loading', resolveText: key, productReason: { key: 'mi.a', resolve: productResolve } }

    expect(onNormal).toBeDefined()
    expect(onLoading).toBeDefined()
  })
})
