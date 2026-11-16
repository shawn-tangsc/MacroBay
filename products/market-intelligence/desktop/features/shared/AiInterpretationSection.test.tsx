// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AiInterpretationSection } from './AiInterpretationSection'

/**
 * 共享的「AI 解读」小节：舆情详情与日历事件详情两处共用（R37）。
 *
 * 这里钉的是**结构判据**，不是像素：
 * - 未请求 → 整节不渲染（不留标题占位）；
 * - 只要节存在，就必然有「标题 + 至少一态内容」——空节即不通过；
 * - 三态互斥（提交中 / 失败 / 成功 只出现一个）；
 * - 元信息那行只用 `evidenceRefCount`，`factCount` 只在审计折叠里。
 */
let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function render(props: Parameters<typeof AiInterpretationSection>[0]): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root?.render(<AiInterpretationSection {...props} />) })
  return host
}

const READY = {
  state: 'ready' as const,
  meta: { generatedAt: '2026-11-16T10:40:00.000Z', evidenceRefCount: 155 },
  audit: {
    asOf: '2026-11-16T10:35:00.000Z',
    dataCutoff: '2026-11-16T10:30:00.000Z',
    domains: ['market', 'funds'],
    factCount: 300,
    runId: 'run-1',
    snapshotHash: 'snap-1'
  },
  paragraphs: ['第一段解读。', '第二段解读。']
}

const section = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('[data-ai-interpretation]') as HTMLElement | null

describe('AiInterpretationSection', () => {
  it('renders nothing at all when it was never requested', () => {
    const host = render({ state: 'idle' })
    expect(section(host)).toBeNull()
    expect(host.textContent?.trim()).toBe('')
  })

  it('pending shows the title, a spinner and the generating sentence — and nothing else', () => {
    const host = render({ state: 'pending' })
    expect(section(host)).not.toBeNull()
    // 节标题自解释；与菜单项的动作名「AI 解读」不是同一句。
    expect(section(host)?.textContent).toContain('这条新闻对市场的影响')
    expect(section(host)?.querySelector(`button[aria-label]`)).not.toBeNull()
    expect(section(host)?.querySelector('.loading-state')).not.toBeNull()
    expect(section(host)?.textContent).toContain('正在生成')
    expect(section(host)?.querySelector('details')).toBeNull()
  })

  it('failure shows the reason and one retry action, and no body', () => {
    const host = render({ state: 'failed', failure: { sentence: '这次没等到结果。', canRetry: true }, onRetry: () => undefined })
    expect(section(host)?.textContent).toContain('这次没等到结果。')
    const retry = section(host)?.querySelector('button.text-action')
    expect(retry).not.toBeNull()
    expect(section(host)?.querySelector('.loading-state')).toBeNull()
    expect(section(host)?.querySelector('details')).toBeNull()
  })

  it('failure without a way forward renders no retry button', () => {
    const host = render({ state: 'failed', failure: { sentence: '分析没启用。', canRetry: false } })
    expect(section(host)?.querySelector('button.text-action')).toBeNull()
  })

  it('ready shows the meta line with the evidence count, the body, and the audit folded away', () => {
    const host = render(READY)
    const meta = section(host)?.querySelector('[data-ai-interpretation-meta]') as HTMLElement
    expect(meta.textContent).toContain('生成于')
    expect(meta.textContent).toContain('生成于')
    // 可见那行只用 evidenceRefCount（155），不许拿 factCount（300）去顶。
    expect(meta.textContent).toContain('155')
    expect(meta.textContent).toContain('条证据')
    expect(meta.textContent).not.toContain('300')

    expect(section(host)?.querySelectorAll('p').length).toBeGreaterThanOrEqual(3)

    const audit = section(host)?.querySelector('details') as HTMLElement
    expect(audit).not.toBeNull()
    expect(audit.textContent).toContain('300')
    expect(audit.textContent).toContain('market')
    expect(audit.querySelector('summary')?.textContent).toBeTruthy()
  })

  it('only ever shows one of the three states', () => {
    for (const props of [
      { state: 'pending' as const },
      { state: 'failed' as const, failure: { sentence: 'x', canRetry: true }, onRetry: () => undefined },
      READY
    ]) {
      const host = render(props)
      const el = section(host)!
      const marks = [
        el.querySelector('.loading-state') !== null,
        el.querySelector('button.text-action') !== null,
        el.querySelector('details') !== null
      ]
      expect(marks.filter(Boolean)).toHaveLength(1)
      act(() => root?.unmount())
      root = undefined
      document.body.innerHTML = ''
    }
  })
})