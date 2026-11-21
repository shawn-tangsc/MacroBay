// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { SourceEnabledRow } from './SourceRows'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 源行上的**采集产出状态**（用户 2026-11-21：设置里情报源健康那一行，把这两个状态显示出来）。
 *
 * 这一行的形状：名字 · 药丸 · 归属标签，下面一行是产出状态（整行宽），行尾照旧是文字状态。
 * 判据：
 * - 两种病同时为真 → **两条都看得见**（不是只读屏能读到、不是二选一）；
 * - 药丸仍然只说采集，产出状态不把它染成失败（两件事不许互相顶替）；
 * - 没有可报的病 → 整块不渲染，不留空行；
 * - 原因有、数字没有 → 落「状态暂时读不到」，不显示半句带空格的模板。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function resolveText(key: string): string {
  const tail = key.replace('settings.intelligenceSources.', '')
  return tail.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], t) as string
}

const baseSource = {
  sourceId: 'coindesk-rss',
  providerId: 'coindesk',
  displayName: 'CoinDesk',
  agents: [],
  panels: ['dashboard'],
  visibility: 'visible',
  collection: 'adapter',
  kind: 'feed',
  capabilities: {},
  readiness: 'live',
  enabled: true,
  healthState: 'healthy',
  healthMarker: 'ok'
} satisfies Record<string, unknown>

const labels = {
  badges: t.sourceBadges,
  jobRegistered: t.jobRegistered,
  jobNotRegistered: t.jobNotRegistered,
  status: t.status
}

async function render(patch: Partial<SourceView>): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourceEnabledRow, {
        labels,
        name: 'CoinDesk',
        proxyConfigured: true,
        resolveText,
        source: { ...baseSource, ...patch } as never,
        tags: [],
        unavailable: false
      })
    }))
  })
  return host
}

function staleText(host: HTMLElement): string {
  return host.querySelector('.source-provider-detail__row-stale')?.textContent ?? ''
}

describe('源行上的采集产出状态', () => {
  it('两种病同时为真：两句话都在正文里，行上不加警告色也仍是绿的药丸', async () => {
    const host = await render({
      staleReasons: ['no-output', 'normalize-failing'],
      staleMeasurements: { noOutputHours: 30, normalizeFailureStreak: 3 }
    })
    const text = staleText(host)
    expect(text).toContain(t.staleReason['no-output'].replace('{hours}', '30'))
    expect(text).toContain(t.staleReason['normalize-failing'].replace('{count}', '3'))
    // 药丸说采集，产出状态说条目：产出问题不改采集结论。
    expect(host.querySelector('[role="switch"]')).toBeNull()
    expect(host.querySelector('.source-provider-detail__row-state')?.textContent).toBe(t.status.applied)
  })

  it('只有一种病时只出现那一句', async () => {
    const host = await render({ staleReasons: ['normalize-failing'], staleMeasurements: { normalizeFailureStreak: 4 } })
    expect(staleText(host)).toBe(t.staleReason['normalize-failing'].replace('{count}', '4'))
  })

  it('没有可报的病：整块不渲染，不留空 span', async () => {
    const host = await render({})
    expect(host.querySelector('.source-provider-detail__row-stale')).toBeNull()
  })

  it('原因有、数字没有：写「状态暂时读不到」，不显示带空格的半句', async () => {
    const host = await render({ staleReasons: ['no-output'] })
    expect(staleText(host)).toBe(t.health.unknown)
    expect(staleText(host)).not.toContain('{hours}')
    expect(staleText(host)).not.toContain('小时没有新内容')
  })
})