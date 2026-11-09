// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { AgentTextProvider } from '../agentTextProvider'
import AutomationSessions from './AutomationSessions'

let root: Root | undefined
let host: HTMLDivElement | undefined

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user' as const,
  orderKey: 'workspace-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function session(id: string, name: string, createdAt: string): AgentSessionEntity {
  return {
    id,
    agentId: 'agent-1',
    name,
    workspaceId: workspace.id,
    workspace,
    orderKey: createdAt,
    origin: 'automation',
    originGroup: 'market-analysis',
    createdAt,
    updatedAt: createdAt
  }
}

const now = new Date()
const todayAt = now.toISOString()
const yesterdayAt = new Date(now.getTime() - 86_400_000).toISOString()

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})


/**
 * 用例断言的是**真实 CSS 链**：把三个样式文件里相关的规则原样注入，再量计算值。
 * jest 环境不加载样式表，所以不注入就等于没测样式。
 */
const REPO_ROOT = join(__dirname, '../../../../../../../..')
function cssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`rule not found: ${selector}`)
  return source.slice(start, source.indexOf('}', start) + 1)
}
function injectStyles(): HTMLStyleElement {
  // 只取与这条判据有关的三条规则：整份 styles.css 有一万多行，happy-dom 解析不了会整块丢掉。
  const collapsibleCss = readFileSync(
    join(REPO_ROOT, 'platform/ui/components/collapsible-group/collapsibleGroup.css'),
    'utf8'
  )
  const blockCss = readFileSync(join(__dirname, 'automationSessions.css'), 'utf8')
  const shellCss = readFileSync(join(__dirname, '../../../styles.css'), 'utf8')
  // happy-dom 不展开 `overflow` 简写，只认 `overflow-y`；真实文件里是简写，注入前按等价长写展开，
  // 两处都保留断言（下面 CSS 链用例仍读原文，真文件没这条简写就会红）。
  const longhand = (rule: string): string => rule.replace(/overflow:\s*(auto|scroll|hidden|visible)/u, 'overflow-y: $1')
  const element = document.createElement('style')
  element.textContent = [
    longhand(cssRule(collapsibleCss, '.collapsible-group__body')),
    longhand(cssRule(blockCss, '.agent-auto-sessions .collapsible-group__body')),
    longhand(cssRule(shellCss, '.agent-session-list'))
  ].join('\n')
  document.head.append(element)
  return element
}
const scrollsVertically = (element: HTMLElement): boolean => {
  const value = getComputedStyle(element).overflowY
  return value === 'auto' || value === 'scroll'
}

async function render(sessions: readonly AgentSessionEntity[], onSelectSession = vi.fn()) {
  await act(async () => root!.render(createElement(ShellTimeZoneProvider, {
    timeZone: 'UTC',
    children: createElement('div', { className: 'agent-session-list' },
      createElement(AgentTextProvider, {
        language: 'zh-CN',
        children: createElement(AutomationSessions, { sessions, onSelectSession })
      })
    )
  })))
  await act(async () => { await Promise.resolve() })
  return { dom: host!, onSelectSession }
}

/**
 * 两层折叠都是 `CollapsibleGroup`：DOM 顺序上第一个头行是整块，后面的是每天。
 * 收起态的判据是**显隐**不是存在——壳给 `aria-controls` 让内容首帧就挂载，
 * 所以「折叠了」= 内容节点在但 `display: none`，不能拿「DOM 里命中 0」去当判据。
 */
const headers = (dom: HTMLElement): HTMLElement[] => [...dom.querySelectorAll<HTMLElement>('.ant-collapse-header')]
const outerHead = (dom: HTMLElement): HTMLElement => headers(dom)[0]!
const dayHeads = (dom: HTMLElement): HTMLElement[] => headers(dom).slice(1)
const contents = (dom: HTMLElement): HTMLElement[] => [...dom.querySelectorAll<HTMLElement>('.ant-collapse-content')]
const isVisible = (content: HTMLElement | undefined): boolean =>
  content !== undefined && !content.className.includes('ant-collapse-content-inactive')

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('automation sessions block', () => {
  it('renders nothing at all when there are no automated sessions', async () => {
    const { dom } = await render([])
    // 0 条 → 整块不出现：读者不该先去怀疑是不是没加载出来。
    expect(dom.querySelector('.agent-auto-sessions')).toBeNull()
  })

  it('collapses to one line that states the total, and says the day count nowhere twice', async () => {
    const { dom } = await render([
      session('a1', '持仓骤降 · 15 分钟', todayAt),
      session('a2', 'ETF 三日净流出越过门槛', todayAt),
      session('a3', '背离：资金-杠杆', yesterdayAt)
    ])

    const head = outerHead(dom)
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.textContent).toContain('自动会话')
    // 块头只留总计；「今天 N 条」不再出现——同一个计数只说一次。
    expect(head.textContent).toContain('共 3 条')
    expect(head.textContent).not.toContain('今天')

    // 日分组标题只写日期，不带条数。
    expect(dayHeads(dom).map((day) => day.textContent)).toEqual(['今天', '昨天'])

    // 收起：行在 DOM 里但不在读者眼前（外层展开区隐藏）。
    expect(isVisible(contents(dom)[0])).toBe(false)
  })

  it('keeps one time per row: a name that already carries the clock does not repeat it', async () => {
    // 自动生成的会话名里常常带时刻（`2026/11/9 20:45 …`）。分组标题已经表达了日期，
    // 行尾再印一遍时刻就是同一行两个时间——所以名字里已有这个时刻时，行尾不再重复。
    const named = `2026/11/9 20:45 ${'持仓骤降 · 15 分钟'}`
    const { dom } = await render([
      session('a1', named, '2026-11-09T20:45:00.000Z'),
      session('a2', '读者自己起的名字', '2026-11-09T20:45:00.000Z')
    ])

    await click(outerHead(dom))

    const rows = [...dom.querySelectorAll<HTMLElement>('.collapsible-group__row--action')]
    const byName = (text: string): HTMLElement => rows.find((row) => row.textContent?.includes(text))!
    // 名字自带时刻：整行只出现一次「20:45」。
    expect(byName(named).textContent?.match(/20:45/gu)).toHaveLength(1)
    // 名字里没有时刻：行尾补上，且仍然只有一次。
    expect(byName('读者自己起的名字').textContent).toContain('20:45')
    expect(byName('读者自己起的名字').textContent?.match(/20:45/gu)).toHaveLength(1)
  })

  it('never renders the run id as a row title when the stored name is that run id', async () => {
    // 老的自动会话把运行 id 当名字存了下来（`mi-ar-<uuid>`）。列表照 `name` 渲染，
    // 读者就在「自动会话」里看到我们的账本编号；这种行只许显示中性文案。
    const runId = 'mi-ar-96eb9b12-005d-4e07-a61c-a98604a962f6'
    const { dom } = await render([
      { ...session('a1', runId, todayAt), originRef: runId }
    ])

    await click(outerHead(dom))

    const rows = [...dom.querySelectorAll<HTMLElement>('.collapsible-group__row--action')]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).not.toContain('mi-ar-')
    expect(rows[0]!.textContent).toContain('未命名会话')
  })

  it('expands into day sections: today open, earlier days closed, and rows select', async () => {
    const onSelectSession = vi.fn()
    const { dom } = await render([
      session('a1', '持仓骤降 · 15 分钟', todayAt),
      session('a3', '背离：资金-杠杆', yesterdayAt)
    ], onSelectSession)

    await click(outerHead(dom))

    expect(outerHead(dom).getAttribute('aria-expanded')).toBe('true')
    const dayContent = contents(dom).slice(1)
    // 今天默认开、昨天默认收：judged by 显隐，不是「DOM 里有没有行」。
    expect(dayHeads(dom).map((day) => day.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    expect(isVisible(dayContent[0])).toBe(true)
    expect(isVisible(dayContent[1])).toBe(false)

    const item = dom.querySelector<HTMLElement>('.collapsible-group__row--action')!
    expect(item.textContent).toContain('持仓骤降 · 15 分钟')
    await click(item)
    expect(onSelectSession).toHaveBeenCalledWith('a1')
  })

  it('opens every day only when the reader asks for all of them', async () => {
    const { dom } = await render([
      session('a1', '持仓骤降 · 15 分钟', todayAt),
      session('a3', '背离：资金-杠杆', yesterdayAt)
    ])

    await click(outerHead(dom))
    const all = dom.querySelector<HTMLElement>('.agent-auto-sessions__all')!
    expect(all.textContent).toBe('查看全部自动会话')
    await click(all)

    expect(dayHeads(dom).map((day) => day.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
  })

  it('with 41 real rows never builds a second scrollbar inside the sidebar', async () => {
    // 真实量级：41 条自动会话。滚动只许有一条，而且在外层 `.agent-session-list`：
    // 展开区自己设上限（`maxBodyHeight` 的默认 320）就会出现第二条滚动条，
    // 外侧那条几乎没内容可滚——就是「小盒子自己滚、盒子下面一大片空白」。
    const { dom } = await render(
      Array.from({ length: 41 }, (_, index) => session(`s${index}`, `自动会话 ${index}`, todayAt))
    )
    await click(outerHead(dom))
    const styles = injectStyles()
    try {
      const bodies = [...dom.querySelectorAll<HTMLElement>('.agent-auto-sessions .collapsible-group__body')]
      expect(bodies.length).toBeGreaterThan(0)

      for (const body of bodies) {
        // 判据 1：展开区不得自带滚动条——计算值上既不是 auto/scroll，也没有高度上限。
        expect(body.style.maxHeight).toBe('')
        expect(body.style.height).toBe('')
        expect(scrollsVertically(body)).toBe(false)
        const maxHeight = getComputedStyle(body).maxHeight
        expect(maxHeight === '' || maxHeight === 'none').toBe(true)
      }

      // 判据 2：这一列只有一个滚动容器，而且就是 `.agent-session-list` 自己。
      const list = dom.querySelector<HTMLElement>('.agent-session-list')!
      expect(scrollsVertically(list)).toBe(true)
      const scrollers = [list, ...list.querySelectorAll<HTMLElement>('*')].filter(scrollsVertically)
      expect(scrollers).toEqual([list])

      const outerBody = dom.querySelector<HTMLElement>('.agent-auto-sessions .collapsible-group__body')!
      expect(outerBody.contains(outerHead(dom))).toBe(false)
      expect(outerBody.querySelectorAll('.collapsible-group__row--action')).toHaveLength(41)
    } finally {
      styles.remove()
    }
  })

  it('keeps exactly one declared scroller in the column, and none in this block', () => {
    // CSS 链：本块的样式表不许再出现 overflow / max-height（出现即等于自己造第二个滚动条）；
    // 侧栏那条唯一滚动条仍由 `.agent-session-list` 声明。两条一起钉——只钉一条会被另一条绕过。
    const blockCss = readFileSync(join(__dirname, 'automationSessions.css'), 'utf8')
    // 本块的规则只许把展开区覆盖成「不滚」：任何 overflow: auto/scroll 或数字上限都会再造一条滚动条。
    expect(blockCss).not.toMatch(/\.agent-auto-sessions[^{]*\{[^}]*overflow(-y)?:\s*(auto|scroll)/iu)
    expect(blockCss).not.toMatch(/\.agent-auto-sessions[^{]*\{[^}]*max-height:\s*\d/iu)

    const shellCss = readFileSync(join(__dirname, '../../../styles.css'), 'utf8')
    const listRule = shellCss.slice(shellCss.indexOf('.agent-session-list {'), shellCss.indexOf('}', shellCss.indexOf('.agent-session-list {')))
    expect(listRule).toContain('overflow: auto')
    expect(listRule).toContain('min-height: 0')
  })

  it('indents days exactly one level, so a row never stacks a third', () => {
    // 界面设计 2026-11-09 写死的判据：块 12 + 日 12 = 24，行内容与日头**对齐在 24**；
    // 行不许再叠一层变成 36。壳的缩进是「头行与行各自 12」，所以这层 12 只能由本块补，
    // 且只能补一次——测的是这条规则本身，不是某一行的行内样式值。
    const css = readFileSync(join(__dirname, 'automationSessions.css'), 'utf8')
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`)
      expect(start).toBeGreaterThan(-1)
      return css.slice(start, css.indexOf('}', start))
    }
    expect(rule('.agent-auto-sessions__day')).toContain('padding-left: 12px')
    // 「查看全部」在同一左缘（24），不是跟更外层对齐。
    expect(rule('.agent-auto-sessions__all')).toContain('padding: 4px 0 4px 24px')
  })
})
