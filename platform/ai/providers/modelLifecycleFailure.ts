import {
  isAccountBalanceUpstreamCode,
  isModelNotActivatedFailure,
  isModelRetiredFailure
} from './providerFailureMapping'
import {
  ProviderRuntimeFailurePolicy,
  toProviderRuntimeFailureCode,
  type ProviderRuntimeFailureCode
} from './modelProviderTypes'

/**
 * PLAT-74：**模型生命周期失败**的单一识别点。
 *
 * 上游对"模型不能用了"的表达非常一致，但此前一路被压成 `provider-request-failed`，
 * UI 只能显示「请重试」，用户不知道要换模型还是去开通。这里只做一件事：
 * 把 (状态码, 上游摘要/正文) 判成三类结论，供助手/智能体两条链路共用。
 *
 *  - `model-retired`：已下线（retired / no longer available / 已下线）；
 *  - `model-not-activated`：未开通（model_not_activated / 未开通模型服务 / 需购买量包）；
 *  - `model-not-found`：404 或上游明确说模型不存在。
 *
 * 其它失败（限流、鉴权、网络、余额）一律返回 `null`，仍走既有兜底，避免把"请重试"误判成"换模型"。
 */
export type ModelLifecycleFailure = 'model-retired' | 'model-not-activated' | 'model-not-found'

export type ModelLifecycleFailureEvidence = {
  status?: number
  summary?: string | null
  body?: string | null
  /**
   * 上游**机器码**（JSON 里的 `error.code` / `error.type`），只用来判「是不是余额类」。
   * 它不是文案：调用方把它当结构字段传进来，这里也只与闭集比较。
   */
  upstreamCode?: string | null
}

const MODEL_NOT_FOUND_PATTERN = /model.*(?:not found|does not exist|no such|unknown model|invalid model)|模型不存在|模型已下线/i
const MODEL_NOT_ACTIVATED_TOKEN = /model[_ ]?not[_ ]?activated/i

export function classifyModelLifecycleFailure(
  evidence: ModelLifecycleFailureEvidence
): ModelLifecycleFailure | null {
  const text = [evidence.summary, evidence.body].filter((part): part is string => Boolean(part)).join(' ')
  if (isModelRetiredFailure(text || null)) return 'model-retired'
  if (isModelNotActivatedFailure(text || null) || MODEL_NOT_ACTIVATED_TOKEN.test(text)) return 'model-not-activated'
  if (evidence.status === 404 || MODEL_NOT_FOUND_PATTERN.test(text)) return 'model-not-found'
  return null
}

/** 生命周期结论 → 渲染层可翻译的稳定 code（上游文案绝不进 UI）。 */
export function modelLifecycleRuntimeFailureCode(failure: ModelLifecycleFailure): ProviderRuntimeFailureCode {
  if (failure === 'model-retired') return ProviderRuntimeFailurePolicy.modelRetired
  if (failure === 'model-not-activated') return ProviderRuntimeFailurePolicy.modelNotActivated
  return ProviderRuntimeFailurePolicy.modelNotFound
}

/**
 * 把任意运行时错误折成稳定 code：先判模型生命周期（需要证据里的状态/摘要/正文），
 * 判不出来才回落到既有 `provider-request-failed` / `provider-configuration-required`。
 * 两个失败类型（`ChatProtocolFailureError` / `AssistantInvocationFailureError`）都带 `evidence`。
 */
export function resolveProviderRuntimeFailureCode(
  error: unknown,
  evidence: ModelLifecycleFailureEvidence = readFailureEvidence(error)
): ProviderRuntimeFailureCode {
  // 余额先判，且只认**结构事实**：HTTP 402，或上游给的余额类机器码（闭集）。
  // 这里刻意不看 `summary`/`body` 的措辞——同一句话今天这么写、明天那么写，猜出来的结论
  // 一旦驱动「等额度恢复」这类行为，错一次就是让读者干等。
  if (evidence.status === 402 || isAccountBalanceUpstreamCode(evidence.upstreamCode)) {
    return ProviderRuntimeFailurePolicy.accountBalanceInsufficient
  }
  const lifecycle = classifyModelLifecycleFailure(evidence)
  if (lifecycle) return modelLifecycleRuntimeFailureCode(lifecycle)
  return toProviderRuntimeFailureCode(error)
}

function readFailureEvidence(error: unknown): ModelLifecycleFailureEvidence {
  if (!error || typeof error !== 'object') return {}
  const candidate = (error as {
    evidence?: { httpStatus?: unknown; summary?: unknown; body?: unknown; upstreamCode?: unknown }
  }).evidence
  if (!candidate || typeof candidate !== 'object') return {}
  return {
    ...(typeof candidate.upstreamCode === 'string' ? { upstreamCode: candidate.upstreamCode } : {}),
    ...(typeof candidate.httpStatus === 'number' ? { status: candidate.httpStatus } : {}),
    ...(typeof candidate.summary === 'string' ? { summary: candidate.summary } : {}),
    ...(typeof candidate.body === 'string' ? { body: candidate.body } : {})
  }
}
