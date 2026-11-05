// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ToastHost } from '@platform/ui/components/toast'
import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { dailyBriefingToMarkdown } from '../../../contracts/dailyBriefingMarkdown'
import { productText } from '../../shared/i18n/productText'
import { DailyBriefingGeneratedBanner } from './DailyBriefingGeneratedBanner'
import { DailyBriefingPage } from './DailyBriefingPage'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingChangeArrows, briefingFearGreedBuckets, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'

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

/** Resolve a dotted product-text key, or `undefined` when the tree has no such leaf. */
function resolveCopy(root: unknown, key: string): string | undefined {
  let node: unknown = root
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

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
      paymentDirectionsCompact: briefingPaymentDirections('zh-CN'), policyWords: briefingPolicyGaugeWords('zh-CN'), changeArrows: briefingChangeArrows('zh-CN'), fearGreedBuckets: briefingFearGreedBuckets('zh-CN')
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
      root.render(createElement(ConfirmProvider, null, createElement(ToastHost, null,
        createElement('div', null,
        createElement(DailyBriefingPage, {
          locale: 'zh-CN',
          text: zh.dailyBriefing,
          onBack: () => undefined,
          onConfigureSources: () => undefined,
          client: client as never
        }),
        createElement(DailyBriefingGeneratedBanner, { locale: 'zh-CN', text: bannerText, client: client as never, now: () => new Date('2026-10-30T04:00:00.000Z') })
        ))))
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

  it('resolves every copy key the product passes as a string — a missing key renders an empty label', () => {
    // `history.deleteEditionCurrent` 那次：键不存在，菜单项渲染成空标签，而 rail 自己的用例用 stub
    // 解析器把它盖住了。原来这条只扫 `DailyBriefingHistoryRail.tsx` 的 `labelKey`，别的文件、别的
    // `*Key` 属性全在网外。这里改成扫**整个产品渲染层**：任何 `XxxKey: 'pages.…'` 都必须在中英两棵
    // 文案树里取到非空句子。
    //
    // 覆盖面说明（写清边界，免得被当成「所有文案都查过了」）：只覆盖**以字符串传的键**。绝大多数
    // 文案是 `text.xxx.yyy` 的对象访问，缺键在 `tsc` 阶段就红了，不需要这条守卫。改动文案传递方式
    // （对象 → 字符串键）时，这条守卫才会开始管它。
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full)
      }
    }
    // 范围写死成「日报目录」是有意的：设置里的通知页有自己的本地文案表，键长得像 `pages.…` 却不在
    // `productText` 里，扫进去只会得到假红（第一次就是这么撞上的）。
    walk(__dirname)

    const pattern = /([A-Za-z]+Key): '(pages\.[^']+)'/g
    const found = new Map<string, string[]>()
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(pattern)) {
        const key = match[2] as string
        found.set(key, [...(found.get(key) ?? []), `${match[1]} in ${file.slice(__dirname.length + 4)}`])
      }
    }
    // 空转即红：正则或写法变了会让它悄悄变成零个键，那样比没有守卫更糟。三个以上是当前实况（两个
    // 删除入口的说明 + 生成阶段的问号），掉到 0–2 就说明扫描本身失效了。
    expect(found.size).toBeGreaterThan(2)
    // 这条键曾经不在库里、靠 stub 混过验收——把它钉死，删了就等于这次教训也删了。
    expect(found.has('pages.intelligence.portal.dashboard.dailyBriefing.history.deleteEditionCurrent')).toBe(true)
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const key of found.keys()) {
        const sentence = resolveCopy(productText[locale], key)
        expect(sentence, `${locale}: ${key}`).toBeTypeOf('string')
        expect(sentence, `${locale}: ${key}`).not.toBe('')
      }
    }
  })

  it('resolves every menu label the rail references — a missing key renders an empty item', () => {
    // `history.deleteEditionCurrent` 曾经不存在，菜单项因此**渲染成空标签**，而 rail 自己的用例用 stub
    // 解析器把它盖住了。这条守卫按源码里出现过的 `labelKey` 逐个回文案树取句子：取不到就是红，
    // 中英各查一次——只查中文，英文缺键时读者看到的仍是一个空项。
    const source = readFileSync(join(__dirname, 'DailyBriefingHistoryRail.tsx'), 'utf8')
    // 只查产品文案树里的键：`ui.*` 是平台的键，由平台自己的守卫管。
    const keys = [...source.matchAll(/labelKey: '(pages\.[^']+)'/g)].map((match) => match[1] as string)
    // 一个都没有就说明这条守卫已经空转（正则或写法变了），那本身就是红。
    expect(keys.length).toBeGreaterThan(0)
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const key of keys) {
        expect(resolveCopy(productText[locale], key), `${locale}: ${key}`).toBeTypeOf('string')
        expect(resolveCopy(productText[locale], key), `${locale}: ${key}`).not.toBe('')
      }
    }
  })

})
