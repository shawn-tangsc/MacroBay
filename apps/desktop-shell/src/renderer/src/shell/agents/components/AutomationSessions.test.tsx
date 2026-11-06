// @vitest-environment happy-dom
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

describe('automation sessions block', () => {
  it('renders nothing at all when there are no automated sessions', async () => {
    const { dom } = await render([])
    // 0 条 → 整块不出现：读者不该先去怀疑是不是没加载出来。
    expect(dom.querySelector('.agent-auto-sessions')).toBeNull()
  })

  it('collapses to one summary line with today and total counts', async () => {
    const { dom } = await render([
      session('a1', '持仓骤降 · 15 分钟', todayAt),
      session('a2', 'ETF 三日净流出越过门槛', todayAt),
      session('a3', '背离：资金-杠杆', yesterdayAt)
    ])

    const head = dom.querySelector('.agent-auto-sessions__head') as HTMLButtonElement
    expect(head).not.toBeNull()
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.textContent).toContain('今天 2 条 · 共 3 条')
    // 收起时不铺开行。
    expect(dom.querySelectorAll('.agent-auto-sessions__item')).toHaveLength(0)
  })

  it('expands into day sections: today open, earlier days closed, and rows select', async () => {
    const onSelectSession = vi.fn()
    const { dom } = await render([
      session('a1', '持仓骤降 · 15 分钟', todayAt),
      session('a3', '背离：资金-杠杆', yesterdayAt)
    ], onSelectSession)

    const head = dom.querySelector('.agent-auto-sessions__head') as HTMLButtonElement
    await act(async () => {
      head.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(head.getAttribute('aria-expanded')).toBe('true')
    const dayHeads = [...dom.querySelectorAll<HTMLButtonElement>('.agent-auto-sessions__day-head')]
    expect(dayHeads.map((button) => button.textContent)).toEqual(['今天1', '昨天1'])
    // 今天默认开：只有今天那一条渲染；昨天默认收。
    expect(dom.querySelectorAll('.agent-auto-sessions__item')).toHaveLength(1)
    expect(dayHeads[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(dayHeads[1]?.getAttribute('aria-expanded')).toBe('false')

    const item = dom.querySelector('.agent-auto-sessions__item') as HTMLButtonElement
    expect(item.textContent).toContain('持仓骤降 · 15 分钟')
    await act(async () => {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(onSelectSession).toHaveBeenCalledWith('a1')
  })

  it('opens every day only when the reader asks for all of them', async () => {
    const { dom } = await render([
      session('a1', '持仓骤降 · 15 分钟', todayAt),
      session('a3', '背离：资金-杠杆', yesterdayAt)
    ])

    const head = dom.querySelector('.agent-auto-sessions__head') as HTMLButtonElement
    await act(async () => { head!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const all = dom.querySelector('.agent-auto-sessions__all') as HTMLButtonElement
    expect(all.textContent).toBe('查看全部自动会话')
    await act(async () => { all.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(dom.querySelectorAll('.agent-auto-sessions__item')).toHaveLength(2)
  })
})
