import type { NotificationDiagnosticsSink } from '../contracts/notificationContracts'

/**
 * 一次提交「抛出来」的那一类留痕（第 10 条同类问题的第二次，2026-11-08）。
 *
 * 被拒是**返回一个值**（那一支在 `notificationRuntime.ts` 的提交漏斗里记），抛异常是另一件事：
 * 读回坏了、规划器炸了、目录实现抛错——调用方（`etfOutflowNotifier` 等六处）都是 `catch {}`，
 * 以前这一整类在日志、记录、计数三处都查不到。
 *
 * 两个码描述两件事，**不合并**（Chief 2026-11-08 定）：
 * - `persist-failed`：记录写不下去，是存储层失败；
 * - `submit-failed`：这一次提交没走完，可能是任何东西。
 *
 * 写盘失败会先记 `persist-failed` 再往上抛，外层**不许再记一条**——同一个失败两个名字，
 * 排障要认两套，正是今晚在修的「查不出」。所以这里用一张只记对象身份的表把它认出来，
 * 不包装错误（包装会改掉调用方 `catch` 到的东西）。
 */
const persistDiagnosed = new WeakSet<object>()

function isTracked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && persistDiagnosed.has(error)
}

/** 存储层失败：记 `persist-failed`，并在表上留个记号，外层据此不再补一条 `submit-failed`。 */
export function reportPersistFailure(input: {
  error: unknown
  diagnostics: NotificationDiagnosticsSink
  at: string
}): void {
  if (typeof input.error === 'object' && input.error !== null) persistDiagnosed.add(input.error)
  input.diagnostics({ code: 'persist-failed', at: input.at })
}

/**
 * 提交抛出：记一条 `submit-failed`。
 *
 * 只带事件类型与**错误类型名**（`TypeError` 这类），不带 `message`——消息里可能带路径或载荷片段，
 * 那正是「不带正文/配置/凭据」要挡的东西。错误对象照原样抛回去，行为不变。
 */
export function traceSubmitFailure<T>(
  run: () => Promise<T>,
  input: { eventTypeId: string; diagnostics: NotificationDiagnosticsSink; at: () => string }
): Promise<T> {
  return run().catch((error: unknown) => {
    if (!isTracked(error)) {
      input.diagnostics({
        code: 'submit-failed',
        level: 'error',
        eventTypeId: input.eventTypeId,
        reason: error instanceof Error ? error.name : typeof error,
        at: input.at()
      })
    }
    throw error
  })
}
