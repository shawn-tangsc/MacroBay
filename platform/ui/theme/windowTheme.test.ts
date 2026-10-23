import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'

import {
  resolveWindowAntdTokenValues,
  resolveWindowBackgroundColor,
  WINDOW_ACCENT_COLOR,
  WINDOW_ANTD_COLOR_TOKENS,
  WINDOW_ANTD_SIZING,
  WINDOW_BACKGROUND_COLOR,
  WINDOW_THEME_VARIANTS
} from './windowTheme'
import { buildWindowAntdTheme } from './windowAntdTheme'

/**
 * Owner: platform/ui/theme（**PLAT-42**：颜色单源收口）。
 *
 * 缺陷（PLAT-39 复核记录）：
 *  ① `platform/desktop/window/createMainWindow.ts:188` 仍**硬编码** `backgroundColor: '#101114'`，
 *     与分离窗「`nativeTheme` 派生」不一致（分离窗 `#0b0d10`/`#ffffff`）——同一个 app 的两类窗口
 *     在正文首帧之前是两种底色；
 *  ② antd token 的 **hex 字面量仍在 TS 里**（`AppShell.getAntdTheme()` 曾有六处、PLAT-39 只把其中一部分
 *     收敛到 `workspaceWindowTheme.tsx`，字面量只是搬了家）。
 *
 * 本文件取证的判据（全部可复算）：
 *  ① **单源存在且唯一**：窗口原生底色只在这里取值，深/浅两态与 `styles.css` 的 `:root --bg` 逐字一致；
 *  ② **主窗与分离窗同源**：`resolveWindowBackgroundColor` 是两个建窗路径的同一个输入→输出映射；
 *  ③ **antd token 由本单源产出**：`buildWindowAntdTheme()` 产出的 ThemeConfig 里**每一个 hex 值**都必须
 *     出现在单源值集中（= 渲染侧没有第二份颜色字面量），且深/浅两态的 token 与 PLAT-39 的 parity 值逐字相同。
 */

const shellCss = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
const rendererThemeFile = readFileSync(
  resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceWindowTheme.tsx'),
  'utf8'
)
const appShellFile = readFileSync(
  resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'),
  'utf8'
)

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 源码里的**注释**允许记录历史值（如 `#101114`）；判据只约束代码本身，因此先剥注释。 */
function withoutSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

function declaration(block: string, property: string): string {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'))
  return match?.[1]?.trim() ?? ''
}

/** `:root`（深色默认）与 `:root[data-theme='light']` 两态的 CSS 变量。 */
function cssVariable(selector: string, property: string): string {
  const css = withoutComments(shellCss)
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  return declaration(block, property)
}

function cssBackgroundToken(selector: string): string {
  return cssVariable(selector, '--bg')
}

/** 收集 ThemeConfig 里出现的全部 hex 颜色字面量（含嵌套 components 段）。 */
function collectHexColors(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.add(match[0].toLowerCase())
    return out
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectHexColors(entry, out)
    return out
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) collectHexColors(entry, out)
  }
  return out
}

/** 单源允许的 hex 值集（ accents + 两态具名 token + 分段控件选中色）。 */
function singleSourceColors(): Set<string> {
  const colors = new Set<string>()
  for (const variant of WINDOW_THEME_VARIANTS) {
    colors.add(WINDOW_BACKGROUND_COLOR[variant].toLowerCase())
    for (const value of Object.values(WINDOW_ANTD_COLOR_TOKENS[variant])) colors.add(String(value).toLowerCase())
    const tokens = resolveWindowAntdTokenValues(variant, 'lime')
    for (const value of Object.values(tokens.segmented)) colors.add(String(value).toLowerCase())
  }
  for (const value of Object.values(WINDOW_ACCENT_COLOR)) colors.add(String(value).toLowerCase())
  return colors
}

describe('PLAT-42 ①：窗口原生底色只有一个来源（主窗与分离窗共用）', () => {
  it('深/浅两态与 styles.css 的 :root --bg 逐字一致（不是第二套调色板）', () => {
    expect(WINDOW_BACKGROUND_COLOR.dark).toBe('#0b0d10')
    expect(WINDOW_BACKGROUND_COLOR.light).toBe('#ffffff')
    expect(cssBackgroundToken(':root')).toBe(WINDOW_BACKGROUND_COLOR.dark)
    expect(cssBackgroundToken(':root[data-theme="light"]')).toBe(WINDOW_BACKGROUND_COLOR.light)
  })

  it('派生值只由「系统是否偏好深色」决定，两个建窗路径共用同一个映射', () => {
    expect(resolveWindowBackgroundColor(true)).toBe(WINDOW_BACKGROUND_COLOR.dark)
    expect(resolveWindowBackgroundColor(false)).toBe(WINDOW_BACKGROUND_COLOR.light)
    // 主窗与分离窗的底色必须可逐字比较：同一个输入 ⇒ 同一个字符串
    expect(resolveWindowBackgroundColor(true)).toBe('#0b0d10')
    expect(resolveWindowBackgroundColor(false)).toBe('#ffffff')
  })
})

describe('PLAT-42 ②：antd token 由同一单源产出', () => {
  it('token 值集在单源里具名，且与 PLAT-39 的 parity 值逐字相同（两窗一致性不回退）', () => {
    // 与 `workspaceWindowThemeParity.test.tsx` 的 DARK_TOKENS / LIGHT_TOKENS 同值
    expect(WINDOW_ANTD_COLOR_TOKENS.dark).toMatchObject({
      colorBgContainer: '#14171c', colorText: '#e7e9ee', colorBorder: '#252a33'
    })
    expect(WINDOW_ANTD_COLOR_TOKENS.light).toMatchObject({
      colorBgContainer: '#ffffff', colorText: '#20221f', colorBorder: '#dedfd8'
    })
    // PLAT-81：控件圆角与 `--control-h: 32px` 配套统一为 8（仍是同一个单源常量）。
    expect(WINDOW_ANTD_SIZING).toMatchObject({ controlHeight: 32, controlHeightSM: 28, controlHeightLG: 36, fontSize: 12, fontSizeSM: 11, borderRadius: 8 })
    expect(WINDOW_ACCENT_COLOR).toEqual({ lime: '#d8ff62', cyan: '#58d7f5', violet: '#b794ff' })
  })

  it('buildWindowAntdTheme 的深/浅两态算法与具名 token 都只取自单源（无第二份字面量）', () => {
    const allowed = singleSourceColors()
    for (const variant of WINDOW_THEME_VARIANTS) {
      for (const accent of ['lime', 'cyan', 'violet'] as const) {
        const config = buildWindowAntdTheme(variant, accent)
        expect(config.algorithm).toBe(variant === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm)
        expect(config.token?.colorPrimary).toBe(WINDOW_ACCENT_COLOR[accent])
        expect(config.token).toMatchObject(WINDOW_ANTD_COLOR_TOKENS[variant])
        expect(config.token).toMatchObject(WINDOW_ANTD_SIZING)
        // 单源判据：ThemeConfig 里出现的每个 hex 颜色都必须是单源里的值
        for (const color of collectHexColors(config)) expect(allowed.has(color)).toBe(true)
      }
    }
  })

  it('accent 底上的文字色由单源给出，并与 styles.css --accent-contrast 逐字一致', () => {
    expect(WINDOW_ANTD_COLOR_TOKENS.dark.colorTextLightSolid).toBe('#141512')
    expect(WINDOW_ANTD_COLOR_TOKENS.light.colorTextLightSolid).toBe('#11130f')
    expect(cssVariable(':root', '--accent-contrast')).toBe(WINDOW_ANTD_COLOR_TOKENS.dark.colorTextLightSolid)
    expect(cssVariable(':root[data-theme="light"]', '--accent-contrast')).toBe(
      WINDOW_ANTD_COLOR_TOKENS.light.colorTextLightSolid
    )
    for (const variant of WINDOW_THEME_VARIANTS) {
      expect(buildWindowAntdTheme(variant, 'lime').token?.colorTextLightSolid).toBe(
        WINDOW_ANTD_COLOR_TOKENS[variant].colorTextLightSolid
      )
    }
  })

  it('分段控件选中色按主题分化：深色用 accent、浅色用深色块（与修复前 antd 观感逐字一致）', () => {
    expect(buildWindowAntdTheme('dark', 'cyan').components?.Segmented).toMatchObject({
      itemSelectedBg: '#58d7f5', itemSelectedColor: '#141512'
    })
    expect(buildWindowAntdTheme('light', 'cyan').components?.Segmented).toMatchObject({
      itemSelectedBg: '#20221f', itemSelectedColor: '#ffffff'
    })
  })

  it('三窗共用同一个 builder：主窗与分离窗的调用点都指向单源函数（结构判据）', () => {
    const builderFile = readFileSync(resolve(process.cwd(), 'platform/ui/theme/windowAntdTheme.ts'), 'utf8')
    expect(builderFile).toContain('export function buildWindowAntdTheme')
    // 主窗（AppShell.getAntdTheme）与分离窗（DetachedWindowThemeShell）调用**同一个符号**
    expect(appShellFile).toContain('buildWindowAntdTheme(')
    expect(rendererThemeFile).toContain('buildWindowAntdTheme(')
    // 单源内部只有一处 antd 算法选择（深/浅两态），渲染侧不得再重复
    expect(builderFile.match(/antdTheme\.(dark|default)Algorithm/g) ?? []).toHaveLength(2)
    // 注释里可以提到算法名（历史说明）；判据只约束代码
    expect(withoutSourceComments(appShellFile)).not.toContain('Algorithm')
    expect(withoutSourceComments(rendererThemeFile)).not.toContain('Algorithm')
  })

  it('渲染侧不再持有颜色字面量：AppShell / workspaceWindowTheme 无 hex 颜色、颜色一律来自单源 import', () => {
    for (const source of [appShellFile, rendererThemeFile]) {
      expect(withoutSourceComments(source)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
    expect(rendererThemeFile).toContain('@platform/ui/theme/windowAntdTheme')
  })
})
