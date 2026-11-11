// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ToastHost } from '@platform/ui/components/toast/ToastHost'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { DailyBriefingEditionActions } from './DailyBriefingPageActions'
import { briefingOnScreenSession } from './briefingOnScreenSession'

/**
 * E9 挪到顶部工具栏之后的两段判据：
 *
 * ① **取哪一条会话**：按屏幕上这一版的 `(date, periodId, locale)` 精确命中，历史多版次时不许取第一版；
 * ② **顶部那颗的行为**：没有会话整颗不渲染；没打开时出一句中性话且再点是**真的再读一次**。
 *
 * 行尾那颗已删（`DailyBriefingHistoryRail.test.tsx` 里有一条「行轨 0 个会话按钮」的守卫）。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const summary = (overrides: Partial<DailyBriefingEditionSummary>): DailyBriefingEditionSummary => ({
  date: '2026-11-02', periodId: 'default', locale: 'zh-CN',
  availableLocales: ['zh-CN'], updatedAt: '2026-11-02T00:00:00.000Z',
  ...overrides
}) as DailyBriefingEditionSummary

const editions: readonly DailyBriefingEditionSummary[] = [
  summary({ sessionId: 'session-first' }),
  summary({ periodId: 'noon', sessionId: 'session-noon' }),
  summary({ periodId: 'evening', sessionId: 'session-evening' }),
  summary({ periodId: 'evening', locale: 'en-US', sessionId: 'session-evening-en' })
]

describe('E9 — the session the toolbar opens is the edition on screen', () => {
  it('matches the on-screen edition exactly, never the first row of the history', () => {
    const picked = briefingOnScreenSession({
      editions,
      edition: { date: '2026-11-02', periodId: 'evening', locale: 'zh-CN' },
      text, locale: 'zh-CN', timeZone: 'Asia/Shanghai'
    })
    expect(picked?.sessionId).toBe('session-evening')
    expect(picked?.label).toContain('11/02')
  })

  it('answers for the language too: the same period in en-US is another session', () => {
    const picked = briefingOnScreenSession({
      editions,
      edition: { date: '2026-11-02', periodId: 'evening', locale: 'en-US' },
      text, locale: 'en-US', timeZone: 'Asia/Shanghai'
    })
    expect(picked?.sessionId).toBe('session-evening-en')
  })

  it('gives nothing when that edition has no session or the day has no edition', () => {
    expect(briefingOnScreenSession({
      editions: [summary({})],
      edition: { date: '2026-11-02', periodId: 'default', locale: 'zh-CN' },
      text, locale: 'zh-CN', timeZone: 'Asia/Shanghai'
    })).toBeUndefined()
    expect(briefingOnScreenSession({
      editions,
      edition: { date: '2026-11-05', periodId: 'default', locale: 'zh-CN' },
      text, locale: 'zh-CN', timeZone: 'Asia/Shanghai'
    })).toBeUndefined()
  })
})

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function renderToolbar(
  openSession?: Readonly<{ sessionId: string; label: string }>,
  onRegenerate: () => void = () => undefined
): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <ShellLanguageProvider language="zh-CN">
      <ConfirmProvider><ToastHost>
        <DailyBriefingEditionActions
          copyState="idle"
          exportState="idle"
          exportable
          generating={false}
          onCopy={() => undefined}
          onExport={() => undefined}
          onRegenerate={onRegenerate}
          push={{ state: { kind: 'idle' }, onPush: () => undefined, onRetry: () => undefined } as never}
          pushText={({} as never)}
          resolveText={(key: string) => key}
          text={text}
          {...(openSession === undefined ? {} : { openSession })}
        />
      </ToastHost></ConfirmProvider>
    </ShellLanguageProvider>
  ))
  return host
}

describe('E9 — the toolbar button', () => {
  it('is not rendered at all when the edition has no session (no disabled placeholder)', async () => {
    const host = await renderToolbar()
    expect(host.querySelector('[data-toolbar-action="open-session"]')).toBeNull()
    expect(host.querySelector('[data-toolbar-action="regenerate-edition"]')).not.toBeNull()
  })

  it('opens the session on a real click, and names the edition in the accessible name', async () => {
    const select = vi.fn(async (id: string) => ({ activeSessionId: id }))
    vi.stubGlobal('platform', { agents: { selectSession: select } })
    const host = await renderToolbar({ sessionId: 'session-evening', label: '打开 11/02 20:00 这一版的会话' })
    const button = host.querySelector<HTMLButtonElement>('[data-toolbar-action="open-session"]')!
    expect(button.textContent).toBe(text.history.openSession)
    expect(button.getAttribute('aria-label')).toBe('打开 11/02 20:00 这一版的会话')
    await act(async () => button.click())
    await act(async () => { await Promise.resolve() })
    expect(select).toHaveBeenCalledWith('session-evening')
  })

  it('keeps the two buttons apart: re-generating never opens a session, opening never re-generates', async () => {
    const select = vi.fn(async (id: string) => ({ activeSessionId: id }))
    vi.stubGlobal('platform', { agents: { selectSession: select } })
    const regenerate = vi.fn()
    const host = await renderToolbar({ sessionId: 'session-evening', label: '打开会话' }, regenerate)
    await act(async () => host.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate-edition"]')!.click())
    await act(async () => { await Promise.resolve() })
    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-toolbar-action="open-session"]')!.click())
    await act(async () => { await Promise.resolve() })
    expect(select).toHaveBeenCalledTimes(1)
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  it('says it did not open, and the next click really reads again', async () => {
    const select = vi.fn(async () => ({ activeSessionId: null }))
    vi.stubGlobal('platform', { agents: { selectSession: select } })
    const host = await renderToolbar({ sessionId: 'session-gone', label: '打开会话' })
    const button = host.querySelector<HTMLButtonElement>('[data-toolbar-action="open-session"]')!
    await act(async () => button.click())
    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('[data-session-not-opened]')?.textContent).toBe(text.history.sessionNotOpened)
    expect(host.textContent).not.toMatch(/不在了|不存在/iu)
    await act(async () => host.querySelector<HTMLButtonElement>('[data-toolbar-action="open-session"]')!.click())
    await act(async () => { await Promise.resolve() })
    expect(select).toHaveBeenCalledTimes(2)
  })
})
