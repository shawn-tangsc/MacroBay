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
    periodId: 'default',
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

function bannerState(): string | null {
  return banner()?.getAttribute('data-daily-brief-banner-state') ?? null
}

async function remount(): Promise<void> {
  await act(() => root.unmount())
  host.remove()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
}

async function dismiss(): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>('.mi-daily-brief-banner__dismiss')
  expect(button).not.toBeNull()
  await act(async () => { button?.click() })
}

describe('daily briefing banner', () => {
  it('announces the newest issue of today when one day has two of the same language', async () => {
    // 一天多期之后，"今天这一行"不能按日期取第一条：那会把早上那版当成刚出的这版。
    await renderBanner({
      editions: [
        { date: '2026-10-30', periodId: 'period-0700', locale: 'zh-CN', availableLocales: ['zh-CN'], state: 'generated', generatedAt: '2026-10-29T23:00:00.000Z' },
        { date: '2026-10-30', periodId: 'period-0800', locale: 'zh-CN', availableLocales: ['zh-CN'], state: 'generated', generatedAt: '2026-10-30T00:00:00.000Z' }
      ],
      now: '2026-10-30T12:00:00.000Z'
    })
    const banner = document.querySelector('[data-daily-brief-generated-banner]')
    expect(banner).not.toBeNull()
    // 取到的是 08:00 那版（00:00Z），不是 07:00 那版（23:00Z 前一天）。
    expect(banner?.textContent).toContain(formatShellInstant('2026-10-30T00:00:00.000Z', {
      timeZone: 'UTC', locale: 'zh-CN', precision: 'minute'
    }))
  })

  it('shows today’s generated briefing in the reader’s language, with its generation time', async () => {
    await renderBanner({ editions: [edition('2026-10-30')], now: '2026-10-30T12:00:00.000Z' })

    expect(bannerState()).toBe('generated')
    expect(host.textContent).toContain(bannerText('zh-CN').title)
    expect(host.textContent).toContain(formatShellInstant(generatedAt, {
      timeZone: 'UTC', locale: 'zh-CN', precision: 'minute'
    }))
    expect(host.textContent).toContain(bannerText('zh-CN').dismiss)
  })

  it('tells the reader today’s briefing is not generated and that opening the brief fills it in', async () => {
    await renderBanner({ editions: [edition('2026-10-30', 'zh-CN', 'missing')], now: '2026-10-30T12:00:00.000Z' })

    expect(bannerState()).toBe('pending')
    expect(host.textContent).toContain(bannerText('zh-CN').pendingTitle)
    expect(host.textContent).toContain(bannerText('zh-CN').pendingHint)
    expect(host.textContent).not.toContain(bannerText('zh-CN').title)
  })

  it('uses the reader’s language for the not-generated notice', async () => {
    await renderBanner({
      editions: [edition('2026-10-30', 'en-US', 'missing')],
      now: '2026-10-30T12:00:00.000Z',
      language: 'en-US'
    })

    expect(bannerState()).toBe('pending')
    expect(host.textContent).toContain('Today’s brief is not generated yet')
    expect(host.textContent).toContain('Open the daily brief to generate it')
  })

  it('does not claim the briefing is missing when the list read fails', async () => {
    await renderBanner({
      editions: [],
      now: '2026-10-30T12:00:00.000Z',
      client: { list: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'time-invalid' })) }
    })
    expect(banner()).toBeNull()

    await renderBanner({
      editions: [],
      now: '2026-10-30T12:00:00.000Z',
      client: { list: vi.fn(async () => { throw new Error('ipc down') }) }
    })
    expect(banner()).toBeNull()
  })

  it('does not claim the briefing is missing when the list has no row for today', async () => {
    // 读取成功但今天这一行不在返回里：这是读不到状态，不是确定没生成。
    await renderBanner({ editions: [edition('2026-10-29')], now: '2026-10-30T12:00:00.000Z' })
    expect(banner()).toBeNull()

    // 今天只有另一语言的版次，也不替当前语言断言「未生成」。
    await renderBanner({ editions: [edition('2026-10-30', 'en-US', 'missing')], now: '2026-10-30T12:00:00.000Z' })
    expect(banner()).toBeNull()
  })

  it('stays away after dismissal, including on a fresh mount', async () => {
    const trigger = '2026-10-30T12:00:00.000Z'
    await renderBanner({ editions: [edition('2026-10-30')], now: trigger })
    expect(banner()).not.toBeNull()

    await dismiss()
    expect(banner()).toBeNull()

    // 刷新/重启：同一个版次重新挂载也不再提示。
    await remount()
    await renderBanner({ editions: [edition('2026-10-30')], now: trigger })
    expect(banner()).toBeNull()
  })

  it('dismisses the not-generated notice for that edition only', async () => {
    const trigger = '2026-10-30T12:00:00.000Z'
    await renderBanner({ editions: [edition('2026-10-30', 'zh-CN', 'missing')], now: trigger })
    expect(bannerState()).toBe('pending')

    await dismiss()
    expect(banner()).toBeNull()

    await remount()
    await renderBanner({ editions: [edition('2026-10-30', 'zh-CN', 'missing')], now: trigger })
    expect(banner()).toBeNull()

    // 同一天后来补生成了：已生成是另一条提示，不该被「未生成」的确认一并压掉。
    await renderBanner({ editions: [edition('2026-10-30')], now: '2026-10-30T15:00:00.000Z' })
    expect(bannerState()).toBe('generated')
    expect(host.textContent).toContain(bannerText('zh-CN').title)
  })

  it('shows again on a new day and in a new language', async () => {
    const editions = [edition('2026-10-31'), edition('2026-10-30')]
    await renderBanner({ editions, now: '2026-10-30T12:00:00.000Z' })
    await dismiss()
    expect(banner()).toBeNull()

    // 新的一天是新的版次，即使同一语言也再次提示。
    await renderBanner({ editions, now: '2026-10-31T12:00:00.000Z' })
    expect(banner()).not.toBeNull()
    expect(host.textContent).toContain(bannerText('zh-CN').title)

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

  it('repeats the not-generated notice on a new date', async () => {
    const editions = [edition('2026-10-30', 'zh-CN', 'missing'), edition('2026-10-31', 'zh-CN', 'missing')]
    await renderBanner({ editions, now: '2026-10-30T12:00:00.000Z' })
    await dismiss()
    expect(banner()).toBeNull()

    await renderBanner({ editions, now: '2026-10-31T12:00:00.000Z' })
    expect(bannerState()).toBe('pending')
    expect(host.textContent).toContain(bannerText('zh-CN').pendingTitle)
  })
})
