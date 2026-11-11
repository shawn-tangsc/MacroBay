import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 「workspace 把宿主的设置入口传给了舆情 feature」这件事用**源码断言**兜住，不造运行时夹具。
 *
 * 为什么不用渲染断言：`MarketAnalysisAgentWorkspace` 的渲染要喂 timeline、选中态、文本树与 feature 的
 * 数据客户端，复刻成本远大于这条「有没有往下传」的结构事实；而漏传正是最常见的断链，
 * 一条读源码的断言就能钉住它（与仓库里其它「透传是结构事实」的判据同形）。
 */
const SOURCE = join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisAgentWorkspace.tsx')

export function passesSettingsThrough(source: string): boolean {
  return /<NewsSentimentFeature[\s\S]{0,600}?onOpenSettings/u.test(source)
}

describe('the workspace hands the settings entry to the sentiment feature', () => {
  it('passes onOpenSettings into NewsSentimentFeature', () => {
    expect(passesSettingsThrough(readFileSync(SOURCE, 'utf8'))).toBe(true)
  })

  it('flags a version that stops passing it', () => {
    expect(passesSettingsThrough('<NewsSentimentFeature language="zh-CN" text={text} />')).toBe(false)
  })
})
