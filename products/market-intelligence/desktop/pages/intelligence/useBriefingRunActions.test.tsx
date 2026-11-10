// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { briefingRowState, resolveBriefingMode } from './dailyBriefingMode'
import { useBriefingRunActions } from './useBriefingRunActions'

/**
 * 所有入口走同一个起点：挂「生成中」那一行、立 generating 标志、清上一次失败。
 *
 * 「生成中文版」这类按钮以前绕过挂行，于是左侧没有那一行、进度也没有挂载点——所以这里直接对
 * hook 断言，不依赖页面在某个视图状态下才露出那颗按钮。
 */
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

type Actions = ReturnType<typeof useBriefingRunActions>

function Harness(input: Readonly<{ actions: (value: Actions) => void; setEditions: (next: (current: readonly DailyBriefingEditionSummary[]) => readonly DailyBriefingEditionSummary[]) => void }>): null {
  const actions = useBriefingRunActions({
    client: { regenerate: vi.fn(() => new Promise<never>(() => undefined)) },
    locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    setView: vi.fn(), setRegenerating: vi.fn(), setRegenerateFailure: vi.fn(),
    setEditions: input.setEditions as never,
    todayDate: '2026-11-05'
  })
  input.actions(actions)
  return null
}

async function render(): Promise<(current: readonly DailyBriefingEditionSummary[]) => readonly DailyBriefingEditionSummary[]> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let captured: ((current: readonly DailyBriefingEditionSummary[]) => readonly DailyBriefingEditionSummary[]) | undefined
  let actions: Actions | undefined
  await act(async () => {
    root!.render(createElement(Harness, {
      actions: (value) => { actions = value },
      setEditions: (next) => { captured = next }
    }))
  })
  // 「生成这一语言」也走唯一入口：不带期号 = 服务端默认期，意图是手动。
  // `runBriefing` 会等到运行结束，这里只关心它**起手**时挂的那一行，所以不 await。
  await act(async () => { void actions!.runBriefing({ locale: 'zh-CN', trigger: 'manual' }) })
  return captured!
}

/** 带真实行状态的夹具：`runBriefing` 会多次改列表，收尾要看最终那一份。 */
function StatefulHarness(input: Readonly<{
  initial: readonly DailyBriefingEditionSummary[]
  regenerate: () => Promise<unknown>
  onRows: (rows: readonly DailyBriefingEditionSummary[]) => void
  onActions: (actions: Actions) => void
}>): null {
  const [rows, setRows] = useState<readonly DailyBriefingEditionSummary[]>(input.initial)
  useEffect(() => { input.onRows(rows) }, [rows, input])
  const actions = useBriefingRunActions({
    client: { regenerate: input.regenerate as never },
    locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    setView: vi.fn(), setRegenerating: vi.fn(), setRegenerateFailure: vi.fn(),
    setEditions: (updater) => setRows((current) => updater(current)),
    todayDate: '2026-11-05'
  })
  input.onActions(actions)
  return null
}

describe('every entry point starts a run the same way', () => {
  it('hangs the generating row for a run started by "generate this language"', async () => {
    const updater = await render()
    const rows = updater([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-11-05', periodId: 'default', locale: 'zh-CN', state: 'missing' })
    expect((rows[0]!.languages ?? []).some((language) => language.state === 'generating')).toBe(true)
  })

  it('deletes only the row this run created — a lookalike row of another period stays', async () => {
    // 收尾不许按"长得像临时行"删：失败后那次清理曾经把**被就地改成 generating 的真行**一起删了。
    // 判据：这次跑没碰过的那一行（哪怕形状刚好一样）必须原样在。
    const failed: DailyBriefingEditionSummary = {
      date: '2026-11-05', periodId: 'default', locale: 'zh-CN', availableLocales: [],
      state: 'missing', attemptCount: 1,
      languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }]
    }
    const lookalike: DailyBriefingEditionSummary = {
      date: '2026-11-05', periodId: 'period_other', locale: 'zh-CN', availableLocales: [],
      state: 'missing',
      languages: [{ locale: 'zh-CN', state: 'generating' }]
    }
    let rows: readonly DailyBriefingEditionSummary[] = []
    let actions!: Actions
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(createElement(StatefulHarness, {
        initial: [failed, lookalike],
        regenerate: async () => ({ state: 'unavailable', failureCode: 'editorial-timeout' }),
        onRows: (next) => { rows = next },
        onActions: (value) => { actions = value }
      }))
    })
    await act(async () => { await actions.runBriefing({ periodId: 'default', locale: 'zh-CN', trigger: 'regenerate' }) })

    expect(rows.map((row) => row.periodId)).toEqual(['default', 'period_other'])
    // 被就地改过的那一行还回失败态；没碰过的那一行一个字没动。
    expect(rows[0]!.languages).toEqual(failed.languages)
    expect(rows[1]).toBe(lookalike)
  })

  it('turns an existing failed row into "generating" instead of leaving it failed', async () => {
    // 用户 2026-11-10 真机：对失败那一期点「重新生成」，行**已经存在**，以前 `withGeneratingRow`
    // 原样返回，于是正文还按旧的失败行判 —— 失败面板和上一次的步骤一直留着，跑完才跳。
    const updater = await render()
    const failed: DailyBriefingEditionSummary = {
      date: '2026-11-05', periodId: 'default', locale: 'zh-CN', availableLocales: [],
      state: 'missing', attemptCount: 1,
      languages: [{ locale: 'zh-CN', state: 'missing', reason: 'run-failed' }]
    }
    const other: DailyBriefingEditionSummary = {
      date: '2026-11-05', periodId: 'default', locale: 'en-US', availableLocales: ['en-US'],
      state: 'generated', generatedAt: '2026-11-05T00:30:00.000Z', windowEnd: '2026-11-05T00:30:00.000Z',
      languages: [{ locale: 'en-US', state: 'published' }]
    }

    const rows = updater([failed, other])

    // 不新增一行：还是那一期那一语言，只是它现在在跑。
    expect(rows).toHaveLength(2)
    expect(briefingRowState(rows[0], 'zh-CN')).toBe('running')
    expect(rows[0]!.languages).toEqual([{ locale: 'zh-CN', state: 'generating' }])
    // 正文据此离开失败档：这就是"点下去就换屏"的判据，行状态一旦是 running，失败面板不再出现。
    expect(resolveBriefingMode({
      rowState: briefingRowState(rows[0], 'zh-CN'), viewStatus: 'unavailable', hasEdition: false, localeAvailable: true
    })).toBe('generating')
    // 另一语言那一行一个字不动。
    expect(rows[1]).toBe(other)
  })
})
