// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingGeneratedBanner } from './DailyBriefingGeneratedBanner'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const bannerText = (language: DailyBriefingLocale) =>
  productText[language].pages.intelligence.portal.dailyBriefingGeneratedBanner

const generatedAt = '2026-10-30T00:30:00.000Z'

function edition(
  date: string,
  locale: DailyBriefingLocale = 'zh-CN',
  state: 'generated' | 'missing' = 'generated'
): DailyBriefingEditionSummary {
  return {
    date,
    locale,
    availableLocales: [locale],
    state,
    ...(state === 'generated' ? { generatedAt } : {})
  }
}

function fakeClient(editions: readonly DailyBriefingEditionSummary[]): Pick<DailyBriefingClient, 'list'> {
  return { list: vi.fn(async () => ({ state: 'available' as const, result: { editions } })) }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function renderBanner(input: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  now: string
  language?: DailyBriefingLocale
  client?: Pick<DailyBriefingClient, 'list'>
}>): Promise<void> {
  const language = input.language ?? 'zh-CN'
  await act(async () => {
    root.render(
      <ShellLanguageProvider language={language}>
        <ShellTimeZoneProvider timeZone="UTC">
          <DailyBriefingGeneratedBanner
            client={input.client ?? fakeClient(input.editions)}
            locale={language}
            now={() => new Date(input.now)}
            text={bannerText(language)}
          />
        </ShellTimeZoneProvider>
      </ShellLanguageProvider>
    )
  })
}

function banner(): Element | null {
  return host.querySelector('[data-daily-brief-generated-banner]')
}

async function dismiss(): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>('.mi-daily-brief-banner__dismiss')
  expect(button).not.toBeNull()
  await act(async () => { button?.click() })
}

describe('daily briefing generated banner', () => {
  it('shows today’s generated briefing in the reader’s language, with its generation time', async () => {
    await renderBanner({ editions: [edition('2026-10-30')], now: '2026-10-30T12:00:00.000Z' })

    expect(banner()).not.toBeNull()
    expect(host.textContent).toContain('今日简报已生成')
    expect(host.textContent).toContain(formatShellInstant(generatedAt, {
      timeZone: 'UTC', locale: 'zh-CN', precision: 'minute'
    }))
  })

  it('stays hidden when no briefing was generated for today', async () => {
    await renderBanner({ editions: [edition('2026-10-30', 'zh-CN', 'missing')], now: '2026-10-30T12:00:00.000Z' })
    expect(banner()).toBeNull()

    await renderBanner({ editions: [], now: '2026-10-31T12:00:00.000Z' })
    expect(banner()).toBeNull()
  })

  it('stays hidden when the list read fails', async () => {
    await renderBanner({
      editions: [],
      now: '2026-10-30T12:00:00.000Z',
      client: { list: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'time-invalid' })) }
    })
    expect(banner()).toBeNull()
  })

  it('stays away after dismissal, including on a fresh mount', async () => {
    const trigger = new Date('2026-10-30T12:00:00.000Z')
    await renderBanner({ editions: [edition('2026-10-30')], now: trigger.toISOString() })
    expect(banner()).not.toBeNull()

    await dismiss()
    expect(banner()).toBeNull()

    // 刷新/重启：同一个版次重新挂载也不再提示。
    await act(() => root.unmount())
    host.remove()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await renderBanner({ editions: [edition('2026-10-30')], now: trigger.toISOString() })
    expect(banner()).toBeNull()
  })

  it('shows again on a new day and in a new language', async () => {
    const editions = [edition('2026-10-31'), edition('2026-10-30')]
    await renderBanner({ editions, now: '2026-10-30T12:00:00.000Z' })
    await dismiss()
    expect(banner()).toBeNull()

    // 新的一天是新的版次，即使同一语言也再次提示。
    await renderBanner({ editions, now: '2026-10-31T12:00:00.000Z' })
    expect(banner()).not.toBeNull()
    expect(host.textContent).toContain('今日简报已生成')

    await dismiss()
    // 同一天的另一语言是另一份版次。
    await renderBanner({
      editions: [edition('2026-10-31', 'en-US')],
      now: '2026-10-31T13:00:00.000Z',
      language: 'en-US'
    })
    expect(banner()).not.toBeNull()
    expect(host.textContent).toContain('Today’s brief is ready')
  })
})
