import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { STATE_VIEW_ACTION_CHOICES, STATE_VIEW_ACTION_RULES } from '../../../contracts/queryOutcome'

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
    const actionKeys = [...window.matchAll(/labelKey=\{?['"]([^'"]+)['"]\}?/g)].map((m) => m[1] ?? '')
    sites.push({
      file: relative(ROOT, file),
      line: text.slice(0, start).split('\n').length,
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
  [`${BASELINE_FILE}|empty.filtered-out`, 1],
  [`${BASELINE_FILE}|disabled.target-disabled`, 1],
  [`${BASELINE_FILE}|empty.nothing-in-window`, 1]
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

  it('keeps none-installed inside its three allowed actions', () => {
    const offenders = sites
      .filter((site) => `${site.state}.${site.reasonCode}` === 'empty.none-installed')
      .flatMap((site) => site.actionKeys.filter((key) => !STATE_VIEW_ACTION_CHOICES['empty.none-installed']!.includes(key)))
      .map((key) => ({ key }))

    expect(offenders).toEqual([])
  })

  it('keeps the baseline shrinking: a fixed entry must be deleted, not left behind', () => {
    // 基线同时覆盖两类违规：必填却没给动作、禁止却给了动作。
    const live = new Map<string, number>()
    for (const site of sites) {
      const rule = STATE_VIEW_ACTION_RULES[`${site.state}.${site.reasonCode}`]
      const broken = (rule === 'required' && !site.hasAction) || (rule === 'forbidden' && site.hasAction)
      if (!broken) continue
      const key = baselineKeyOf(site)
      live.set(key, (live.get(key) ?? 0) + 1)
    }
    const stale = [...BASELINE.keys()].filter((entry) => (live.get(entry) ?? 0) === 0)

    expect(stale).toEqual([])
  })

  it('cannot pass vacuously: every literal call site was parsed with a known code', () => {
    expect(sites.length).toBeGreaterThan(0)
    for (const site of sites) {
      expect(STATE_VIEW_ACTION_RULES[`${site.state}.${site.reasonCode}`], `${site.file}:${site.line} 用了码表里没有的码`).toBeDefined()
    }
  })
})
