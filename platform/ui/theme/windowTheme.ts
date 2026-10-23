import type { AccentColor } from '../../settings/schema/appSettings'

/**
 * Owner: platform/ui/theme（**PLAT-42：颜色单源收口**）。
 *
 * 缺陷（PLAT-39 复核记录）：
 *  ① `platform/desktop/window/createMainWindow.ts:188` 硬编码 `backgroundColor: '#101114'`，而分离窗按
 *     `nativeTheme.shouldUseDarkColors` 派生 `#0b0d10`/`#ffffff` ⇒ 同一个 app 的两类窗口在正文首帧之前
 *     是两种底色，且 `#101114` 不对应任何主题 token（既不是 `--bg` 也不是 `--surface`）；
 *  ② antd token 的 hex 字面量仍在 TS 里（`AppShell.getAntdTheme()` 曾六处；PLAT-39 只把它们搬到
 *     `workspaceWindowTheme.tsx`，字面量只是换了位置）。
 *
 * 本模块是**唯一来源**：
 *  - **窗口原生底色**（`WINDOW_BACKGROUND_COLOR`）：深/浅两态与 `styles.css` 的 `:root --bg` /
 *    `:root[data-theme='light'] --bg` 逐字一致。主窗（`window/createMainWindow.ts`）与分离窗
 *    （`main/workspace/panelDetachedWindowFactory.ts`）都只经 `resolveWindowBackgroundColor()` 取值，
 *    两条建窗路径因此不可能再各说一套；
 *  - **antd 颜色与尺寸**（`WINDOW_ACCENT_COLOR` / `WINDOW_ANTD_COLOR_TOKENS` / `WINDOW_ANTD_SIZING`）：
 *    主窗与分离窗共用同一个 `ThemeConfig` 产出函数（`./windowAntdTheme`），渲染侧不再持有任何 hex 字面量。
 *
 * 本文件**不 import antd**（主进程也会 import 它取底色，绝不能把 antd 拖进主进程包）；
 * 把值装配成 antd `ThemeConfig` 的职责在 `./windowAntdTheme.ts`（渲染侧专用）。
 */

export type WindowThemeVariant = 'dark' | 'light'

/** 两态的稳定顺序：判据与遍历都按它来，绝不依赖对象键序。 */
export const WINDOW_THEME_VARIANTS: readonly WindowThemeVariant[] = Object.freeze(['dark', 'light'])

/**
 * 窗口**原生底色**（只在正文首次绘制之前可见）：取 app 背景 token `--bg`，不取 `--surface`。
 * 深色 `#0b0d10` = `styles.css` `:root --bg`；浅色 `#ffffff` = `:root[data-theme='light'] --bg`。
 */
export const WINDOW_BACKGROUND_COLOR: Readonly<Record<WindowThemeVariant, string>> = Object.freeze({
  dark: '#0b0d10',
  light: '#ffffff'
})

/** 唯一派生入口：主窗与分离窗共用（同一个输入 ⇒ 逐字相同的字符串）。 */
export function resolveWindowBackgroundColor(systemPrefersDark: boolean): string {
  return systemPrefersDark ? WINDOW_BACKGROUND_COLOR.dark : WINDOW_BACKGROUND_COLOR.light
}

/** 强调色的 token 值（antd `colorPrimary` 与深色分段控件选中底色共用同一份）。 */
export const WINDOW_ACCENT_COLOR: Readonly<Record<AccentColor, string>> = Object.freeze({
  lime: '#d8ff62',
  cyan: '#58d7f5',
  violet: '#b794ff'
})

/** antd 具名颜色 token 的深/浅两态（PLAT-39 的 parity 值逐字保留 ⇒ 两窗颜色一致性不回退）。 */
export const WINDOW_ANTD_COLOR_TOKENS: Readonly<Record<WindowThemeVariant, Readonly<{
  colorBgContainer: string
  colorBgElevated: string
  colorBorder: string
  colorText: string
  colorTextSecondary: string
  /**
   * antd primary/solid 变体上的文字色（= `styles.css` 的 `--accent-contrast`）。
   * 不设它时 antd 默认给白色，在 accent 荧光底上不可读；深/浅两态都必须是 on-accent 深色。
   */
  colorTextLightSolid: string
}>>> = Object.freeze({
  dark: Object.freeze({
    colorBgContainer: '#14171c',
    colorBgElevated: '#191d23',
    colorBorder: '#252a33',
    colorText: '#e7e9ee',
    colorTextSecondary: '#8d95a3',
    colorTextLightSolid: '#141512'
  }),
  light: Object.freeze({
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#dedfd8',
    colorText: '#20221f',
    colorTextSecondary: '#73766e',
    colorTextLightSolid: '#11130f'
  })
})

/** 与主题态无关的尺寸 token（密集、工具化；数值与修复前逐字一致）。 */
export const WINDOW_ANTD_SIZING = Object.freeze({
  controlHeight: 32,
  controlHeightSM: 28,
  controlHeightLG: 36,
  fontSize: 12,
  fontSizeSM: 11,
  /* PLAT-81：与 `--control-h: 32px` 配套的控件圆角（单源：只在这里改）。 */
  borderRadius: 8
})

/** 组件级尺寸/字重 token（同上：逐字保留修复前的观感）。 */
export const WINDOW_ANTD_COMPONENT_SIZING = Object.freeze({
  buttonFontWeight: 650,
  switchTrackHeightSM: 18,
  switchTrackMinWidthSM: 32
})

/**
 * 分段控件选中色按主题分化：深色用 accent 底 + 深色字；浅色用深色块 + 白字。
 * 深色的 `itemSelectedBg` 就是 accent（与修复前逐字一致），因此只能由 `resolveWindowAntdTokenValues()` 产出。
 */
export const WINDOW_ANTD_SEGMENTED = Object.freeze({
  // 深色分段选中块就是 accent 底 ⇒ 文字色必须与 on-accent 单源同值。
  dark: Object.freeze({ itemSelectedColor: WINDOW_ANTD_COLOR_TOKENS.dark.colorTextLightSolid }),
  light: Object.freeze({ itemSelectedBg: '#20221f', itemSelectedColor: '#ffffff' })
})

/** 单源产出的完整 token 值集（纯数据；装配成 antd `ThemeConfig` 见 `./windowAntdTheme`）。 */
export type WindowAntdTokenValues = Readonly<{
  colorPrimary: string
  colorBgContainer: string
  colorBgElevated: string
  colorBorder: string
  colorText: string
  colorTextSecondary: string
  colorTextLightSolid: string
  controlHeight: number
  controlHeightSM: number
  controlHeightLG: number
  fontSize: number
  fontSizeSM: number
  borderRadius: number
  buttonFontWeight: number
  switchTrackHeightSM: number
  switchTrackMinWidthSM: number
  segmented: Readonly<{ itemSelectedBg: string; itemSelectedColor: string }>
}>

export function resolveWindowAntdTokenValues(
  variant: WindowThemeVariant,
  accentColor: AccentColor
): WindowAntdTokenValues {
  const accent = WINDOW_ACCENT_COLOR[accentColor]
  const colors = WINDOW_ANTD_COLOR_TOKENS[variant]
  return Object.freeze({
    ...WINDOW_ANTD_SIZING,
    colorPrimary: accent,
    colorBgContainer: colors.colorBgContainer,
    colorBgElevated: colors.colorBgElevated,
    colorBorder: colors.colorBorder,
    colorText: colors.colorText,
    colorTextSecondary: colors.colorTextSecondary,
    colorTextLightSolid: colors.colorTextLightSolid,
    buttonFontWeight: WINDOW_ANTD_COMPONENT_SIZING.buttonFontWeight,
    switchTrackHeightSM: WINDOW_ANTD_COMPONENT_SIZING.switchTrackHeightSM,
    switchTrackMinWidthSM: WINDOW_ANTD_COMPONENT_SIZING.switchTrackMinWidthSM,
    segmented: Object.freeze({
      // 深色：选中块就是 accent（与修复前 antd `itemSelectedBg: accent` 逐字一致）
      itemSelectedBg: variant === 'dark' ? accent : WINDOW_ANTD_SEGMENTED.light.itemSelectedBg,
      itemSelectedColor: WINDOW_ANTD_SEGMENTED[variant].itemSelectedColor
    })
  })
}
