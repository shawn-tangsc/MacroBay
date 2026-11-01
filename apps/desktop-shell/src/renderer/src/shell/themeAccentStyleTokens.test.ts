import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  WINDOW_ACCENT_COLOR,
  WINDOW_ACCENT_COLOR_LIGHT,
  WINDOW_ANTD_COLOR_TOKENS
} from '@platform/ui/theme/windowTheme'

/**
 * 强调色的 CSS ↔ TS 同步检查。
 *
 * `styles.css` 与 `platform/ui/theme` 分属两层，谁也不能 import 对方，所以这两份值只能靠一条
 * 「读文本」的用例保证一致——注释不算单一来源。它同时守住另一件事：**浅色 token 只允许定义一次**。
 * 曾经顶部改成了白字、文件末尾又有一个同特异度的 `:root[data-theme='light']` 块把它整块盖回去，
 * 于是「修好了」而实际生效的仍是旧值；那种错编译器不会说话。
 */

const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

/** 根节点上的主题块（不含后代选择器，如 `:root[data-theme='light'] .ant-btn-primary`）。 */
function rootBlocks(): Array<{ theme: 'dark' | 'light'; body: string }> {
  const pattern = /:root(\[data-theme=(['"])light\2\])?\s*\{([^}]*)\}/g
  const blocks: Array<{ theme: 'dark' | 'light'; body: string }> = []
  for (const match of css.matchAll(pattern)) {
    blocks.push({ theme: match[1] ? 'light' : 'dark', body: match[3] })
  }
  return blocks
}

function token(theme: 'dark' | 'light', name: string): string[] {
  const values: string[] = []
  for (const block of rootBlocks()) {
    if (block.theme !== theme) continue
    for (const match of block.body.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`, 'g'))) {
      values.push(match[1].toLowerCase())
    }
  }
  return values
}

describe('accent colour: one definition per theme, in sync with the theme module', () => {
  it('defines the light accent colour exactly once', () => {
    const accent = token('light', 'accent')
    expect(accent).toEqual([WINDOW_ACCENT_COLOR_LIGHT.lime])
  })

  it('defines the light on-accent label exactly once, and it is readable', () => {
    const label = token('light', 'accent-contrast')
    expect(label).toEqual([WINDOW_ANTD_COLOR_TOKENS.light.colorTextLightSolid])
    // 白字在浅色强调底上必须过 AA，否则就是「改了值但看不见」。
    expect(contrast(label[0], WINDOW_ACCENT_COLOR_LIGHT.lime)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the dark theme unchanged and still in sync', () => {
    expect(token('dark', 'accent')).toEqual([WINDOW_ACCENT_COLOR.lime])
    expect(token('dark', 'accent-contrast')).toEqual([WINDOW_ANTD_COLOR_TOKENS.dark.colorTextLightSolid])
    expect(contrast(WINDOW_ANTD_COLOR_TOKENS.dark.colorTextLightSolid, WINDOW_ACCENT_COLOR.lime)).toBeGreaterThanOrEqual(4.5)
  })
})

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (high + 0.05) / (low + 0.05)
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const size = value.length === 3 ? 1 : 2
  const channels = [0, 1, 2].map((index) => {
    const part = value.slice(index * size, index * size + size)
    const channel = parseInt(size === 1 ? part + part : part, 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
