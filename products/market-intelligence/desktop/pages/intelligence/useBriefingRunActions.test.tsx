// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
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

describe('every entry point starts a run the same way', () => {
  it('hangs the generating row for a run started by "generate this language"', async () => {
    const updater = await render()
    const rows = updater([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-11-05', periodId: 'default', locale: 'zh-CN', state: 'missing' })
    expect((rows[0]!.languages ?? []).some((language) => language.state === 'generating')).toBe(true)
  })
})
