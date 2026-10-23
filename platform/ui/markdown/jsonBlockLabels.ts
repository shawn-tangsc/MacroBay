import type { AppLanguage } from '../../settings/schema/appSettings'

/**
 * Owner: platform/ui/markdown（PLAT-64）。
 *
 * JSON 代码块的折叠/卡片文案。放在 platform/ui 而不是 shell 的 `platformText`：同一段 markdown 也会被
 * 产品页渲染（market-intelligence 的分析会话），文案必须跟着**渲染它的那棵树**的语言走；
 * 语言来自 `useShellLanguage()`（shell 主窗与产品页都会提供），未提供时用 zh-CN 默认值（同 shell 默认）。
 */
export type JsonBlockLabels = {
  expand: string
  collapse: string
  foldedLines: (count: number) => string
  rawJson: string
  hideRawJson: string
}

export const jsonBlockLabels: Record<AppLanguage, JsonBlockLabels> = {
  'zh-CN': {
    expand: '展开',
    collapse: '收起',
    foldedLines: (count) => `已折叠 ${count} 行`,
    rawJson: '查看原始 JSON',
    hideRawJson: '收起原始 JSON'
  },
  'en-US': {
    expand: 'Expand',
    collapse: 'Collapse',
    foldedLines: (count) => `${count} more lines folded`,
    rawJson: 'Show raw JSON',
    hideRawJson: 'Hide raw JSON'
  }
}
