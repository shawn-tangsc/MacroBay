import { fallbackTimeZone, systemTimeZoneSetting, type AppSettings, type ThemeMode } from '@platform/settings/schema/appSettings'

/**
 * Owner: platform/desktop/main/workspace / P1-06h（N3）。
 *
 * 面板窗宿主上下文的 `preferences.theme` 必须与 **app 的 themeMode 设置同源**（shell 读的也是同一份 settings），
 * 只有 `themeMode === 'system'` 时才回退 OS 的 `nativeTheme.shouldUseDarkColors`。
 * 真机症状（P1-07 / N3）：这里此前直接取 OS 值，app=dark 时上下文仍报 light，与 shell 显示不一致。
 *
 * 纯函数 + 依赖注入：不 import electron、无顶层副作用、不读 profile/密钥，便于用注入的 settings store 断言三态映射。
 */

/** 上下文里可以出现的**已解析**主题（renderer 侧 preferences.theme 是 string，但平台只产出这两个值）。 */
export type ResolvedContextTheme = 'dark' | 'light'

/** 设置来源（与 shell 同源）：只需要只读 `get()`，因此 store 或任意只读包装都可注入。 */
export type WorkspaceSettingsReader = { get: () => AppSettings | Promise<AppSettings> }
/** OS 偏好来源（nativeTheme 的最小投影）；只在 `system` 分支被读到，且是惰性求值（P1-06i / C）。 */
export type SystemDarkModeSource = { shouldUseDarkColors: boolean }

export function resolveWorkspaceContextTheme(themeMode: ThemeMode, systemPrefersDark: boolean): ResolvedContextTheme {
  if (themeMode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return themeMode
}

/**
 * 上下文的 `getTheme` 实现：每次调用都重新读设置（切换 themeMode 立即生效，绝不缓存旧主题）。
 * OS 偏好只是 `system` 分支的兜底输入，绝不作为默认答案。
 *
 * P1-06i（C）：`system.shouldUseDarkColors` 必须**只在 system 分支**被求值（此前它作为实参被无条件求值，
 * 实测显式 dark/light 也会读 4/4 次 OS，与上面的注释不符，并给 non-system 路径凭空引入 nativeTheme 依赖）。
 * 惰性读取同时消除该副作用：显式 dark/light 时 OS 读取次数为 0。
 */
/**
 * 上下文的 `getTimeZone` 实现：设置值是 `system` 时解析为**运行时的 IANA 时区**（渲染层只拿可直接格式化的
 * id），否则原样透传。`system.timeZone` 由调用方注入，因此本模块保持纯函数、可断言三态（跟随/显式/解析不出）。
 *
 * 与主题不同，这里不缓存：设置切换后下一次读取立即生效（`read` 每次重新读设置）。
 */
export function readWorkspaceContextTimeZone(
  settings: WorkspaceSettingsReader,
  system: { timeZone: string }
): Promise<string> {
  return Promise.resolve(settings.get()).then((value) =>
    value.timeZone === systemTimeZoneSetting ? system.timeZone || fallbackTimeZone : value.timeZone)
}

export function readWorkspaceContextTheme(
  settings: WorkspaceSettingsReader,
  system: SystemDarkModeSource
): Promise<ResolvedContextTheme> {
  return Promise.resolve(settings.get()).then((value) =>
    value.themeMode === 'system' ? resolveWorkspaceContextTheme('system', system.shouldUseDarkColors) : value.themeMode)
}
