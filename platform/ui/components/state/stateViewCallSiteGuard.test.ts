import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { STATE_VIEW_ACTION_CHOICES, STATE_VIEW_ACTION_RULES } from '../../../contracts/queryOutcome'
import { STATE_VIEW_ACTION_KEYS } from './stateViewText'

/**
 * 调用点扫描（契约 §16 第二条守卫）。
 *
 * 「有没有动作」从类型里拿掉之后，编译期不再拦得住两种错：
 * 标 `required` 的码没给动作（读者被丢在一个没有出路的页面里），
 * 标 `forbidden` 的码给了动作（假按钮）。
 *
 * 这里只看**字面量**调用点：`state="empty" reasonCode="not-yet"` 这种。传变量、或组件之间透传的，
 * 由定义处判——守卫不替它们作证，也不假装扫描过。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'platform', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

type CallSite = {
  file: string
  line: number
  /** 开标签原文：条件展开这类形状只能从这里判。 */
  source: string
  state: string
  reasonCode: string
  actionKeys: string[]
  hasAction: boolean
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.tsx$/.test(entry.name)) continue
    if (/\.test\.tsx$/.test(entry.name)) continue
    found.push(join(dir, entry.name))
  }
  return found
}

/** 每个 `<StateView …>` 开标签取一段窗口；JSX 里属性顺序不固定，所以窗口而不是正则一次解析。 */
const OPEN_TAG = /<StateView\b/g
const WINDOW = 600

function callSitesIn(file: string): CallSite[] {
  const text = readFileSync(file, 'utf8')
  const sites: CallSite[] = []
  for (const match of text.matchAll(OPEN_TAG)) {
    const start = match.index ?? 0
    const raw = text.slice(start, start + WINDOW)
    // 自闭合标签到此为止：不截断的话，窗口会吃进下一个相邻的 <StateView>，把它的动作算到上一个头上。
    const close = raw.indexOf('/>')
    const window = close >= 0 ? raw.slice(0, close) : raw
    const state = /state="([a-z]+)"/.exec(window)?.[1]
    const reasonCode = /reasonCode="([a-z-]+)"/.exec(window)?.[1]
    if (state === undefined || reasonCode === undefined) continue
    const hasAction = /\baction=/.test(window)
    // 两种写法都要认：字面量（`labelKey: 'ui.state.action.x'`）与常量引用
    // （`labelKey: STATE_VIEW_ACTION_KEYS.x`）。后者是我们推荐给调用点的写法，
    // 只认字面量的话，守卫保护的范围内恰好不含它自己鼓励的那种写法。
    const literalKeys = [...window.matchAll(/labelKey=\{?['"]([^'"]+)['"]\}?/g)].map((m) => m[1] ?? '')
    const constantKeys = [...window.matchAll(/STATE_VIEW_ACTION_KEYS\.(\w+)/g)]
      .map((m) => STATE_VIEW_ACTION_KEYS[m[1] as keyof typeof STATE_VIEW_ACTION_KEYS])
      .filter((key): key is string => typeof key === 'string')
    const actionKeys = [...literalKeys, ...constantKeys]
    sites.push({
      file: relative(ROOT, file),
      line: text.slice(0, start).split('\n').length,
      source: window,
      state,
      reasonCode,
      actionKeys,
      hasAction
    })
  }
  return sites
}

const sites = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root))).flatMap(callSitesIn)

/**
 * 已有的三处缺口（情报线迁移批之前就存在，2026-11-02 扫描确认）。
 *
 * 与 `danger-color` 基线同一套规矩：**只减不增**。修掉一处必须同笔删掉对应行，否则这条会红——
 * 基线留着过期条目，等于假装还欠着；而新加的违规一条都不许进这里。
 */
const BASELINE_FILE =
  'products/market-intelligence/desktop/features/industry/news-sentiment/NewsSentimentCard.tsx'

/** 按「文件 + 码」记，不按行号：那一行随时会被别的线往上挪，行号基线第二天就变成假红。 */
const BASELINE = new Map<string, number>([
  [`${BASELINE_FILE}|empty.nothing-in-window`, 1],
  // 情报线迁移中：`nothing-in-window` 目前只有 `productReason`，没有动作（文档要求「看全部」）。
  // 已在群里报给他们；修掉后这两行必须同笔删掉，否则「只减不增」那条会红。
  [
    'products/market-intelligence/desktop/features/macro/economic-calendar/EconomicCalendar.tsx|empty.nothing-in-window',
    1
  ],
  ['products/market-intelligence/desktop/pages/intelligence/MarketCalendarCard.tsx|empty.nothing-in-window', 1],
])

/** 三种写法都算条件展开：三元展开、`&&` 展开、`action={cond ? … : undefined}`。 */
const CONDITIONAL_SPREAD = [
  /\.\.\.\(\s*[^)]*\?[^)]*\{[^}]*action\s*:/,
  /\.\.\.\(\s*[^)]*&&[^)]*\{[^}]*action\s*:/,
  /action=\{\s*[^{}]*\?/
]

/**
 * 白名单违规的已知欠账（**只减不增**）。扫描器第一次能看见常量写法后暴露出的三处，
 * 都在别的线上，都不由我改；修掉一处必须同笔删掉对应行。
 *
 * 与上面那份基线分开：那一份记「有没有动作」，这一份记「键对不对」。
 */
const KEY_BASELINE = new Map<string, number>([
  // 情报线：`nothing-in-window` 的动作是「看全部」，站点给的是「打开设置」。
  [
    'products/market-intelligence/desktop/features/macro/economic-calendar/CalendarEmptyMonthState.tsx|empty.nothing-in-window',
    1
  ],
  // 情报线：`filtered-out` 的动作是「清除筛选」，站点给的是「看全部」。
  [
    'products/market-intelligence/desktop/settings/intelligence-sources/SyncRunSection.tsx|empty.filtered-out',
    1
  ]
])

function baselineKeyOf(site: CallSite): string {
  return `${site.file}|${site.state}.${site.reasonCode}`
}

describe('StateView call sites match the action rules', () => {
  it('gives every code that requires an action one', () => {
    const offenders = sites
      .filter((site) => STATE_VIEW_ACTION_RULES[`${site.state}.${site.reasonCode}`] === 'required')
      .filter((site) => !site.hasAction)
      .filter((site) => !BASELINE.has(baselineKeyOf(site)))

    expect(offenders).toEqual([])
  })

  it('never gives a code that forbids an action one', () => {
    const offenders = sites
      .filter((site) => STATE_VIEW_ACTION_RULES[`${site.state}.${site.reasonCode}`] === 'forbidden')
      .filter((site) => site.hasAction)
      .filter((site) => !BASELINE.has(baselineKeyOf(site)))

    expect(offenders).toEqual([])
  })

  it('gives every required code a whitelist, so no code is left unprotected', () => {
    // 一个码落地时忘了加白名单，这条先红——否则「键对不对」这一列对它是没有守卫的。
    const missing = Object.entries(STATE_VIEW_ACTION_RULES)
      .filter(([, rule]) => rule === 'required')
      .map(([code]) => code)
      .filter((code) => STATE_VIEW_ACTION_CHOICES[code] === undefined)

    expect(missing).toEqual([])
  })

  it('keeps every call-site action inside its own code whitelist', () => {
    const offenders = sites.flatMap((site) => {
      const code = `${site.state}.${site.reasonCode}`
      const allowed = STATE_VIEW_ACTION_CHOICES[code]
      if (allowed === undefined) return []
      return site.actionKeys
        .filter((key) => !allowed.includes(key))
        .map((key) => ({ file: site.file, line: site.line, code, key }))
    })
    const unbaselined = offenders.filter((entry) => (KEY_BASELINE.get(`${entry.file}|${entry.code}`) ?? 0) === 0)

    expect(unbaselined).toEqual([])
  })

  it('红夹具：`never-created` 配 `focus-form` 必须被报出（这次真出过的组合）', () => {
    // 用一个合成的调用点跑真实判据：夹具不依赖产品代码，产品代码改了它也不会失效。
    const fake: CallSite = {
      file: 'fixture.tsx',
      line: 1,
      source: '<StateView state="empty" reasonCode="never-created" action={{ labelKey: \'ui.state.action.focus-form\' }} />',
      state: 'empty',
      reasonCode: 'never-created',
      actionKeys: ['ui.state.action.focus-form'],
      hasAction: true
    }
    const allowed = STATE_VIEW_ACTION_CHOICES['empty.never-created']!
    const offenders = fake.actionKeys.filter((key) => !allowed.includes(key))

    expect(offenders).toEqual(['ui.state.action.focus-form'])
  })

  it('keeps the key baseline shrinking too', () => {
    const live = new Map<string, number>()
    for (const site of sites) {
      const code = `${site.state}.${site.reasonCode}`
      const allowed = STATE_VIEW_ACTION_CHOICES[code]
      if (allowed === undefined) continue
      const broken = site.actionKeys.filter((key) => !allowed.includes(key)).length
      if (broken === 0) continue
      const key = `${site.file}|${code}`
      live.set(key, (live.get(key) ?? 0) + broken)
    }
    const stale = [...KEY_BASELINE.keys()].filter((entry) => (live.get(entry) ?? 0) === 0)

    expect(stale).toEqual([])
  })

  it('keeps the baseline shrinking: a fixed entry must be deleted, not left behind', () => {
    // 基线覆盖三类违规：必填却没给动作、禁止却给了动作、动作写成条件展开。
    const live = new Map<string, number>()
    for (const site of sites) {
      const rule = STATE_VIEW_ACTION_RULES[`${site.state}.${site.reasonCode}`]
      const broken =
        (rule === 'required' && !site.hasAction) ||
        (rule === 'forbidden' && site.hasAction) ||
        CONDITIONAL_SPREAD.some((pattern) => pattern.test(site.source))
      if (!broken) continue
      const key = baselineKeyOf(site)
      live.set(key, (live.get(key) ?? 0) + 1)
    }
    const stale = [...BASELINE.keys()].filter((entry) => (live.get(entry) ?? 0) === 0)

    expect(stale).toEqual([])
  })

  it('never spreads the action conditionally: a state is either shown or not, its button is not optional', () => {
    const offenders = sites
      .filter((site) => CONDITIONAL_SPREAD.some((pattern) => pattern.test(site.source)))
      .filter((site) => !BASELINE.has(baselineKeyOf(site)))
      .map((site) => `${site.file}:${site.line}`)

    expect(offenders).toEqual([])
  })

  it('cannot pass vacuously: every literal call site was parsed with a known code', () => {
    expect(sites.length).toBeGreaterThan(0)
    for (const site of sites) {
      expect(STATE_VIEW_ACTION_RULES[`${site.state}.${site.reasonCode}`], `${site.file}:${site.line} 用了码表里没有的码`).toBeDefined()
    }
  })
})
