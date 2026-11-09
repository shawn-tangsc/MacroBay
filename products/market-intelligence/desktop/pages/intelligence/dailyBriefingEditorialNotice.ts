import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 这一期因为没有 AI 解读而要说的话（r17）：三种情形、三句不同的话、三种动作。
 *
 * 判定只读**失败码**，从不读报错文本（2026-11-09 平衡码落地后的口径）：
 * - 余额：`provider-account-balance-insufficient`（平台按 HTTP 402 或余额类机器码给出）；
 * - 没配好：模型不可用 / 未就绪 / 供应商停用 / 缺 Key；
 * - 这次没写成：限流、超时、供应商报错。
 *
 * 文案里不出现内部词（事实层/回退/降级），也不出现原始错误码——读者要的是"我该做什么"。
 */
export type EditorialNoticeCase = 'no-model' | 'model-failed' | 'quota'
export type EditorialNoticeAction = 'configure' | 'regenerate'

const noModelCodes: readonly string[] = Object.freeze([
  'model-unavailable', 'model-not-ready', 'provider-disabled', 'missing-api-key'
])

export function editorialNoticeCase(code: string): EditorialNoticeCase {
  if (code === 'provider-account-balance-insufficient') return 'quota'
  return noModelCodes.includes(code) ? 'no-model' : 'model-failed'
}

export function editorialNotice(
  code: string | undefined,
  text: DailyBriefingText
): Readonly<{ case: EditorialNoticeCase; sentence: string; action?: EditorialNoticeAction }> | undefined {
  if (!code || code === 'editorial-disabled') return undefined
  const kind = editorialNoticeCase(code)
  const reasons: Readonly<Record<string, string>> = text.aiSettings.noticeReason
  const reason = reasons[code] ?? reasons['provider-error'] ?? ''
  if (kind === 'quota') return { case: kind, sentence: text.aiSettings.notice.quota }
  if (kind === 'no-model') return { case: kind, sentence: text.aiSettings.notice.noModel, action: 'configure' }
  return { case: kind, sentence: text.aiSettings.notice.failed.replace('{reason}', reason), action: 'regenerate' }
}
