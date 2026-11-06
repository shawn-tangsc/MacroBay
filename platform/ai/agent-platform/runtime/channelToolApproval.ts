/**
 * 手机通道的工具审批策略。
 *
 * 手机上没有卡片可点，等一个 UI 确认就等于把这一轮挂死（用户 2026-11-04 看到「确认交互 1/1」卡住）。
 * 分两类处理，**都不阻塞**：
 * - 非权限类提问（`AskUserQuestion` 这种）→ 拒绝调用，并告诉模型「直接在正文里用 1/2/3/4 列出选项」，
 *   读者在手机上回一个序号就是下一轮输入；
 * - 权限类动作（写文件 / 跑命令 / 改配置）→ 拒绝，并回一句「这个操作要在应用里做」。
 */
import type { ToolApprovalDecision } from './policy'

const channelQuestionDowngradeMessage =
  '当前是手机通道，无法显示确认卡片。请直接把问题写在回答正文里，用 1/2/3/4 编号列出选项，让读者回复序号即可。'
const channelPermissionDeniedMessage = '这个操作要在应用里做。'

const channelSessions = new Set<string>()

/** 组合根在通道分发前调用：这个会话的工具审批按手机通道的规则直接收口。 */
export function markChannelSession(sessionId: string): void {
  channelSessions.add(sessionId)
}

export function isChannelSession(sessionId: string): boolean {
  return channelSessions.has(sessionId)
}

/** 收回标记（通道停用，或测试之间复位）：之后这个会话恢复「排队等界面」的普通行为。 */
export function unmarkChannelSession(sessionId: string): void {
  channelSessions.delete(sessionId)
}

export function resetChannelSessions(): void {
  channelSessions.clear()
}

/**
 * 通道会话的审批决定：手机上没有卡片可点，所以直接给一个决定，让这一轮继续往下走。
 * **不会排队、不会发确认卡**。
 */
export function channelToolApprovalDecision(toolName: string): ToolApprovalDecision {
  return {
    behavior: 'deny',
    message: /AskUserQuestion|ask_user_question/i.test(toolName)
      ? channelQuestionDowngradeMessage
      : channelPermissionDeniedMessage
  }
}
