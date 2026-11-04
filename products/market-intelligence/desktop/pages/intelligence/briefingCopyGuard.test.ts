// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmProvider } from '@platform/ui/components/confirm'
import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { productText } from '../../shared/i18n/productText'
import { DailyBriefingGeneratedBanner } from './DailyBriefingGeneratedBanner'
import { DailyBriefingPage } from './DailyBriefingPage'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'

/**
 * 门槛 6 的守卫：日报的产物里不许出现「读数」或「N/4」这类写法。
 *
 * 这一条曾经只存在于设计文档里，于是同一类问题一晚漏了三次（海报、复制文本、文案键）：
 * 每次都是「改完了」，下一处又冒出来。守卫做成两条腿——
 * ① 扫字符串字面量（页面与文案目录、跳过注释）；
 * ② 扫真实产物（复制出的 Markdown、海报渲染出的文本）。
 *
 * 命中夹具是常驻断言：「读数」「4/4」各一条必须被抓到，干净样本必须为 0——这样才是
 * 「放回去会变红」，而不是今晚演一次给验收人看。
 */

const BANNED = [/读数/, /\d\/4/]

/** 纯函数：给一批字符串，返回命中的那些。夹具直接调用它，不依赖文件系统。 */
export function bannedBriefingCopy(strings: readonly string[]): readonly string[] {
  return strings.filter((value) => BANNED.some((pattern) => pattern.test(value)))
}

/** 文案树里所有叶子句子。 */
function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(flattenStrings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenStrings)
  return []
}

/** 跳过注释后取出字符串字面量：只扫会出现在界面上的字，不扫解释性的文字。 */
function stringLiterals(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  return [...withoutComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((value) => value.trim().length > 0)
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry) && !entry.includes('.test.') ? [full] : []
  })
}

const guardDocument = (): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: '今日要点。', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null,
      window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    funds: [{
      id: 'etf-btc', group: 'funds', labelKey: 'dailyBriefing.row.etfBtc',
      importance: { tier: 'support', source: 'rule', reasonCode: 'gap' },
      state: 'unavailable', value: null, change: null, window: 'trading-day',
      observedAt: null, reason: 'etf-unavailable'
    }],
    sentiment: { fearGreed: null, news: { state: 'empty' } }
  },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z' }
})

describe('briefing copy guard', () => {
  it('catches the two banned shapes when they are put back', () => {
    expect(bannedBriefingCopy(['ETF 读数不可用', '4/4 项', '四项数据都读不到', 'ETF 数据不可用']))
      .toEqual(['ETF 读数不可用', '4/4 项'])
    expect(bannedBriefingCopy(['四项数据都读不到', 'ETF 数据不可用', '4 项'])).toEqual([])
  })

  it('finds no banned literal in the brief page files and its copy subtree', () => {
    const root = join(process.cwd(), 'products/market-intelligence/desktop')
    // The rule is about the brief's own surfaces: its page files and its copy subtree. Other
    // features' copy in the same shared table is not this guard's business.
    const pageFiles = sourceFiles(join(root, 'pages/intelligence')).filter((file) => /\/dailyBriefing/i.test(file))
    const copyFiles = [join(root, 'shared/i18n/text/pages/dailyBriefing.ts')]
    const hits = [...pageFiles, ...copyFiles]
      .flatMap((file) => bannedBriefingCopy(stringLiterals(readFileSync(file, 'utf8'))).map((value) => `${file}: ${value}`))
    const subtree = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
    expect(hits).toEqual([])
    expect(bannedBriefingCopy(flattenStrings(subtree))).toEqual([])
    expect(bannedBriefingCopy(flattenStrings(productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing))).toEqual([])
  })

  it('writes no banned word into the copied Markdown', () => {
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
    const markdown = dailyBriefingToMarkdown(guardDocument(), {
      labels: text,
      locale: 'zh-CN',
      direction: (term) => term,
      formatTime: (value) => value
    })
    expect(bannedBriefingCopy([markdown])).toEqual([])
  })

  it('renders no banned word in the exported poster', () => {
    const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
    const html = renderToStaticMarkup(createElement(DailyBriefingShareCard, {
      document: guardDocument(), text, locale: 'zh-CN', formatTime: (value: string) => value,
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN')
    }))
    expect(bannedBriefingCopy([html.replace(/<[^>]+>/g, ' ')])).toEqual([])
  })
  it('renders the whole brief page — banner included — without a banned word', async () => {
    const zh = productText['zh-CN'].pages.intelligence.portal.dashboard
    const bannerText = productText['zh-CN'].pages.intelligence.portal.dailyBriefingGeneratedBanner
    const edition = guardDocument()
    const client = {
      getToday: async () => ({ state: 'available' as const, document: edition }),
      list: async () => ({
        state: 'available' as const,
        result: { editions: [{
          date: '2026-10-30', periodId: 'default', locale: 'zh-CN' as const,
          availableLocales: ['zh-CN' as const], state: 'generated' as const,
          generatedAt: '2026-10-30T00:30:00.000Z', readingsAvailable: 4, windowEnd: '2026-10-30T00:30:00.000Z'
        }] }
      }),
      get: async () => ({ state: 'available' as const, document: edition }),
      regenerate: async () => ({ state: 'available' as const, document: edition }),
      getProgress: async () => ({ state: 'idle' as const })
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    // Effects have to run for the page to paint: a static render would assert on an empty shell,
    // which is the "forever green net" this case exists to avoid.
    await act(async () => {
      root.render(createElement(ConfirmProvider, null,
        createElement('div', null,
        createElement(DailyBriefingPage, {
          locale: 'zh-CN',
          text: zh.dailyBriefing,
          onBack: () => undefined,
          onConfigureSources: () => undefined,
          client: client as never
        }),
        createElement(DailyBriefingGeneratedBanner, { locale: 'zh-CN', text: bannerText, client: client as never, now: () => new Date('2026-10-30T04:00:00.000Z') })
        )))
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const text = host.textContent ?? ''
    root.unmount()
    // The banner's own copy tree is what this net exists for: prove the text is really on screen.
    expect(text).toContain(bannerText.title)
    expect(bannedBriefingCopy([text])).toEqual([])
  })

  it('keeps every English stage name short enough to print in full', () => {
    // The rail's name column is narrow, and a stage name is the only thing that says what the step
    // does: a name cut to "Field respons…" tells the reader nothing. English names are single words
    // of at most 14 characters; the full sentence lives behind the question mark.
    const english = (productText['en-US'] as unknown as {
      pages: { intelligence: { portal: { dashboard: { dailyBriefing: { generationTrace: { stages: Record<string, string> } } } } } }
    }).pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stages
    for (const [id, name] of Object.entries(english)) {
      expect(name.length, `${id}: ${name}`).toBeLessThanOrEqual(14)
      expect(name, id).not.toMatch(/\s{2,}|^\s|\s$/)
    }
  })

})
