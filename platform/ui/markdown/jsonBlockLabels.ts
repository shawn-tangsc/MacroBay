import type { AppLanguage } from '../../settings/schema/appSettings'

/**
 * Owner: platform/ui/markdown（PLAT-64）。
 *
 * 整块 JSON 的可访问名称。放在 platform/ui 而不是 shell 的 `platformText`：同一段 markdown 也会被
 * 产品页渲染（例如某个产品里的分析会话），名称必须跟着**渲染它的那棵树**的语言走；语言来自
 * `useShellLanguage()`，未提供时用 zh-CN 默认值（与 shell 默认一致）。
 *
 * 只保留这一条。折叠/展开那组文案已随折叠一起删除（2026-11-01），**不要因为「以前这里还有别的」
 * 再加回来**——整段 JSON 现在一次显示完整，没有可折叠的状态，也就没有可写的按钮文案。
 */
export type JsonBlockLabels = {
  region: string
}

export const jsonBlockLabels: Record<AppLanguage, JsonBlockLabels> = {
  'zh-CN': { region: 'JSON 内容，可用方向键滚动查看' },
  'en-US': { region: 'JSON content; use the arrow keys to scroll' }
}
