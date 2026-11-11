// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { marketAnalysisRunSessionText } from './marketAnalysisRunSessionText'
import { createMarketAnalysisContextRenderers } from './MarketAnalysisContextCard'
import { MarketAnalysisRunSessionCard } from './MarketAnalysisRunSessionCard'
import type { MarketAnalysisRunOutcomeLoad } from '../../shared/ipc/marketAnalysisRunOutcome'

const text = marketAnalysisRunSessionText['zh-CN']
const failureReasons = Object.freeze({
  'analysis-missing-evidence': '分析输出与冻结证据不一致，已拒绝发布，请重试；若持续失败请检查情报来源。'
})

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

async function mount(loadRun: (runId: string) => Promise<MarketAnalysisRunOutcomeLoad>, runId: string | null = 'mi-ar-1'): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const card = (
    <MarketAnalysisRunSessionCard failureReasons={failureReasons} loadRun={loadRun} runId={runId} text={text} />
  )
  await act(async () => {
    root?.render(<ShellTimeZoneProvider timeZone="Asia/Shanghai">{card}</ShellTimeZoneProvider>)
  })
  await act(async () => { await Promise.resolve() })
  return host
}

const available = (overrides: Partial<MarketAnalysisRunOutcomeLoad & { state: 'available' }> = {}): MarketAnalysisRunOutcomeLoad => ({
  state: 'available',
  run: {
    id: 'mi-ar-1',
    status: 'invalid-output',
    failureCode: 'analysis-missing-evidence',
    queuedAt: '2026-11-11T07:03:10.189Z',
    startedAt: '2026-11-11T07:03:10.192Z',
    completedAt: '2026-11-11T07:05:28.259Z',
    ...(overrides.state === 'available' ? overrides.run : {})
  }
})

describe('the run card on an automatic session', () => {
  it('shows the status, the reason in plain words and the fact that no text was produced', async () => {
    const dom = await mount(async () => available())
    expect(dom.textContent).toContain(text.status['invalid-output'])
    expect(dom.textContent).toContain(text.noBody)
    expect(dom.textContent).toContain(failureReasons['analysis-missing-evidence'])
    // 内部错误码不上屏。
    expect(dom.textContent).not.toContain('analysis-missing-evidence')
    // 起止时刻按显示时区，不手拼。
    expect(dom.textContent).toContain('15:03')
    expect(dom.textContent).toContain('15:05')
  })

  it('leaves a successful run to its text: status only, no "no text" sentence', async () => {
    const dom = await mount(async () => ({
      state: 'available',
      run: { ...(available() as Extract<MarketAnalysisRunOutcomeLoad, { state: 'available' }>).run, status: 'succeeded', failureCode: null }
    }))
    expect(dom.textContent).toContain(text.status.succeeded)
    expect(dom.textContent).not.toContain(text.noBody)
  })

  it('says a run left no record — a fact, not an error and not a blank', async () => {
    const dom = await mount(async () => ({ state: 'no-record' }))
    expect(dom.textContent).toContain(text.noRecord)
    expect(dom.querySelector('.state-view')).toBeNull()
  })

  it('turns a failed read into an error with a retry that re-reads', async () => {
    const loadRun = vi.fn(async (): Promise<MarketAnalysisRunOutcomeLoad> => { throw new Error('ipc down') })
    const dom = await mount(loadRun)
    expect(dom.querySelector('.state-view')).not.toBeNull()
    const retry = [...dom.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('重试'))
    expect(retry).toBeDefined()
    await act(async () => { retry?.click() })
    await act(async () => { await Promise.resolve() })
    expect(loadRun).toHaveBeenCalledTimes(2)
  })

  it('does not ask for anything when the card carries no run id', async () => {
    const loadRun = vi.fn(async (): Promise<MarketAnalysisRunOutcomeLoad> => ({ state: 'no-record' }))
    const dom = await mount(loadRun, null)
    expect(loadRun).not.toHaveBeenCalled()
    expect(dom.textContent).toContain(text.noRecord)
  })
})

describe('the product renderer registry', () => {
  it('renders the run card for the market-analysis-run context instead of the neutral card', async () => {
    const renderers = createMarketAnalysisContextRenderers({
      analysis: '引用分析',
      event: '选中事件',
      failureReasons,
      runSession: text
    })
    const renderer = renderers['market-analysis-run']
    expect(renderer).toBeDefined()

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(<ShellTimeZoneProvider timeZone="Asia/Shanghai">
        {renderer!({ part: {
          type: 'agent-context',
          kind: 'market-analysis-run',
          label: '市场分析',
          payload: { runId: 'mi-ar-1' }
        } })}
      </ShellTimeZoneProvider>)
    })
    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('[data-run-card]')).not.toBeNull()
  })
})
