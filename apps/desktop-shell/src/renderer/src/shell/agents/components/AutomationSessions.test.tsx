// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { COLLAPSIBLE_GROUP_BODY_MAX_HEIGHT } from '@platform/ui/components/collapsible-group'
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

async function render(sessions: readonly AgentSessionEntity[], onSelectSession = vi.fn()) {
  await act(async () => root!.render(createElement(ShellTimeZoneProvider, {
    timeZone: 'UTC',
    children: createElement(AgentTextProvider, {
      language: 'zh-CN',
      children: createElement(AutomationSessions, { sessions, onSelectSession })
    })
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

  it('with 41 real rows scrolls only the expanded area and never the block header', async () => {
    // 真实量级：41 条自动会话。头行必须留在滚动容器**外面**，否则读者往下一翻就找不到
    // 「自动会话」这块了；内层每天一组不设上限，避免两条互相套着的滚动条。
    const { dom } = await render(
      Array.from({ length: 41 }, (_, index) => session(`s${index}`, `自动会话 ${index}`, todayAt))
    )
    await click(outerHead(dom))

    const outerBody = dom.querySelector<HTMLElement>('.agent-auto-sessions .collapsible-group__body')!
    expect(outerBody.style.maxHeight).toBe(`${COLLAPSIBLE_GROUP_BODY_MAX_HEIGHT}px`)
    expect(outerBody.contains(outerHead(dom))).toBe(false)
    expect(outerBody.querySelectorAll('.collapsible-group__row--action')).toHaveLength(41)

    const dayBody = dom.querySelectorAll<HTMLElement>('.collapsible-group__body')[1]!
    expect(dayBody.style.maxHeight).toBe('')
  })
})
