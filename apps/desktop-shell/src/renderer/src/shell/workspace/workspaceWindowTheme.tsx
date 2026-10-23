import { useEffect, useState, type ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'

import type { AccentColor, AppLanguage, ThemeMode } from '@platform/settings/schema/appSettings'
import { resolveThemeMode, toThemeAttributes, type ResolvedThemeMode } from '@platform/ui/theme/themeModel'
import { buildWindowAntdTheme } from '@platform/ui/theme/windowAntdTheme'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-39 ②**：分离窗与应用主窗**颜色风格一致**）。
 *
 * PLAT-02 行数纪律：本模块从 `WorkspaceWindowRoot.tsx` 抽出「窗口级外观 + antd 主题外壳」这一族
 * （根属性值表、外观读取、主题外壳），窗口根只保留角色/布局/ACK 语义。
 * PLAT-42：antd token 的**唯一来源**已上移到 `platform/ui/theme`（`windowTheme` + `windowAntdTheme`），
 * 主窗与分离窗共用同一个 `buildWindowAntdTheme()`；本文件不再持有任何颜色字面量。
 * 搬运纪律：语义逐字不变；**根属性的 DOM 写入点仍唯一**（窗口根把自己的写入函数注进来）。
 *
 * 用户实测（PM 追加判据）：「分离出的窗口颜色风格都要和应用一致，不得出现浅色/白色」。三条纪律：
 *  1) **同一套 token**：主窗正文在 `ConfigProvider`（darkAlgorithm + 具名 token）里渲染，分离窗此前
 *     **没有** `ConfigProvider` ⇒ 同一组件在分离窗拿的是 antd 默认**浅色** token（真机实测：同一个
 *     `.ant-segmented` 在主窗是 `fontSize 12px / borderRadius 5px`，在分离窗退化成 `14px / 4px`；
 *     未被 `styles.css` 的 `!important` 覆盖覆盖到的组件——抽屉/弹窗/表格/空态/下拉——直接用浅色底）。
 *     因此 token 的**唯一来源**上移到 `platform/ui/theme`（PLAT-42），主窗与分离窗共用
 *     同一个产出函数（绝不在分离窗里复制一份十六进制字面量）。
 *  2) **根属性逐字相同**：主窗写 `data-theme`/`data-theme-mode`/`data-accent`（同一个 `toThemeAttributes`），
 *     分离窗此前只写 `data-theme` ⇒ 缺项；这里统一补全，且**主题值**仍以受控上下文为准（PLAT-10 不放宽，
 *     归属与作用域判定零改动）。
 *  3) **首帧即成立**：属性在角色解析完成、正文首次提交**之前**写好（不是首次绘制后由 `useEffect` 补写）。
 */

/** 分离窗的窗口级外观：与主窗**同一来源**（既有 `platform.settings.get()`）与同一写入函数。 */
export type WorkspaceWindowAppearance = { themeMode: ThemeMode; accentColor: AccentColor }

/** 与 `createDefaultAppSettings()` 逐字一致：只在**读不到**设置时用于 antd 算法的兜底（不写根属性）。 */
const DEFAULT_WINDOW_APPEARANCE: WorkspaceWindowAppearance = Object.freeze({ themeMode: 'system', accentColor: 'lime' })

/** 既有 preload 面（`platform.settings.get`）的结构子集；缺一即视为「读不到外观」⇒ 不写（fail closed）。 */
export function readWindowAppearanceBridge(host: unknown = globalThis): { get: () => Promise<unknown> } | null {
  const platform = (host as { platform?: unknown } | null)?.platform as { settings?: unknown } | undefined
  const settings = platform?.settings as { get?: unknown } | undefined
  if (typeof settings?.get !== 'function') return null
  return { get: () => Promise.resolve((settings.get as () => Promise<unknown>).call(settings)) }
}

/** 只接受白名单取值；任一字段脏/缺失即整体丢弃（绝不把未知字符串写进根属性）。 */
export function normalizeWindowAppearance(value: unknown): WorkspaceWindowAppearance | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as { themeMode?: unknown; accentColor?: unknown }
  const themeMode = record.themeMode === 'dark' || record.themeMode === 'light' || record.themeMode === 'system'
    ? record.themeMode
    : null
  const accentColor = record.accentColor === 'lime' || record.accentColor === 'cyan' || record.accentColor === 'violet'
    ? record.accentColor
    : null
  if (themeMode === null || accentColor === null) return null
  return { themeMode, accentColor }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
}

/**
 * 分离窗根属性的**值表**（纯函数，DOM 写入由调用方唯一执行）：
 * 值集与主窗逐字相同（同一个 `toThemeAttributes`），但 `data-theme` 在受控上下文可解析时**由受控值覆盖**
 * （PLAT-10：主题值的权威仍是 Main）。上下文不可解析时写设置派生的值——绝不臆造，也绝不放宽归属判定。
 */
export function detachedWindowRootAttributes(input: {
  contextTheme: string | null
  appearance: WorkspaceWindowAppearance | null
  systemPrefersDark: boolean
}): Record<string, string> {
  const attributes: Record<string, string> = {}
  if (input.appearance !== null) {
    Object.assign(attributes, toThemeAttributes(input.appearance.themeMode, input.appearance.accentColor, input.systemPrefersDark))
  }
  if (input.contextTheme === 'dark' || input.contextTheme === 'light') attributes['data-theme'] = input.contextTheme
  return attributes
}

/** 分离窗的 antd 语言包：与主窗同一取值口径（只认白名单语言，其余一律 en-US）。 */
export function resolveWorkspaceWindowAntdLocale(language: AppLanguage): typeof zhCN {
  return language === 'zh-CN' ? zhCN : enUS
}

/**
 * 分离窗的窗口级外观：读一次设置（既有 `platform.settings.get()`，**不新增通道/preload 方法**），
 * 并在受控上下文每次刷新时**有界地**跟读一次（只在真的变化时写回状态 ⇒ 绝不自持环）。
 * `enabled` 为假（主窗/shell/resolving）时**零读写**：主窗根属性仍完全由 shell 负责。
 */
export function useDetachedWindowAppearance(input: {
  contextTheme: string | null
  enabled: boolean
  write: (attributes: Readonly<Record<string, string>>) => void
}): {
  appearance: WorkspaceWindowAppearance | null
  /** 首次提交正文**之前**同步写根属性（首帧起即与主窗一致；不等到首帧之后的 effect）。 */
  applyBeforeFirstCommit: (contextTheme: string) => Promise<void>
} {
  const [appearance, setAppearance] = useState<WorkspaceWindowAppearance | null>(null)
  const { contextTheme, enabled, write } = input
  const remember = (next: WorkspaceWindowAppearance | null): void => {
    if (next === null) return
    setAppearance((previous) => previous !== null
      && previous.themeMode === next.themeMode && previous.accentColor === next.accentColor
      ? previous
      : next)
  }
  const writeNow = (theme: string | null, value: WorkspaceWindowAppearance | null): void => {
    const attributes = detachedWindowRootAttributes({ contextTheme: theme, appearance: value, systemPrefersDark: systemPrefersDark() })
    if (Object.keys(attributes).length > 0) write(attributes)
  }
  useEffect(() => {
    if (!enabled) return
    writeNow(contextTheme, appearance)
    const bridge = readWindowAppearanceBridge()
    if (bridge === null) return
    let cancelled = false
    void bridge.get()
      .then((value) => { if (!cancelled) remember(normalizeWindowAppearance(value)) })
      .catch(() => undefined)
    return () => { cancelled = true }
    // `write` 是窗口根的模块级稳定函数、`writeNow`/`remember` 只做有界写入 ⇒ 依赖只保留会驱动重放的三项
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, contextTheme, appearance])
  return {
    appearance,
    applyBeforeFirstCommit: async (theme: string): Promise<void> => {
      const bridge = readWindowAppearanceBridge()
      const value = bridge === null
        ? null
        : await bridge.get().then((raw) => normalizeWindowAppearance(raw)).catch(() => null)
      remember(value)
      writeNow(theme, value)
    }
  }
}

/**
 * 分离窗正文的主题/语言外壳（无 DOM 输出；只把受控主题与语言下发给 antd 组件）。
 * 解析顺序与根属性**逐字一致**：受控 `data-theme` 优先（PLAT-10 的权威），其次设置派生的主题，
 * 两者都没有时按浅色默认（与修复前的 antd 行为逐字相同）。
 */
export function DetachedWindowThemeShell({ language, contextTheme, appearance, children }: {
  language: AppLanguage
  contextTheme: string | null
  appearance: WorkspaceWindowAppearance | null
  children: ReactNode
}): React.ReactElement {
  const resolvedTheme: ResolvedThemeMode = contextTheme === 'dark' || contextTheme === 'light'
    ? contextTheme
    : resolveThemeMode((appearance ?? DEFAULT_WINDOW_APPEARANCE).themeMode, systemPrefersDark())
  const accentColor: AccentColor = 'lime'
  return (
    <ConfigProvider
      locale={resolveWorkspaceWindowAntdLocale(language)}
      theme={buildWindowAntdTheme(resolvedTheme, accentColor)}
    >{children}</ConfigProvider>
  )
}
