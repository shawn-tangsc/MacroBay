import { describe, expect, it } from 'vitest'

import { AssistantInvocationFailureError } from '../assistant-platform/runtime/assistantInvocationFailureEvidence'
import { ChatProtocolFailureError, readChatProviderFailure } from '../chat/chatProtocolFailure'
import { ProviderRuntimeFailurePolicy } from './modelProviderTypes'
import { resolveProviderRuntimeFailureCode } from './modelLifecycleFailure'

/**
 * 余额用尽的**运行期**失败码（`provider-account-balance-insufficient`）。
 *
 * 为什么必须单列：日报那条「等额度恢复」的文案要按码分支。折进 `provider-request-failed` 之后，
 * 「没配好」「被限流」「欠费」三种处理完全不同的事只能显示同一句「请重试」，而欠费重试没有用。
 *
 * 判据只认**结构事实**：上游 `error.code` 这类机器码（闭集）或 HTTP 402。
 * 正文里出现同样几个字**不算**——那是猜（红线二），今天这么写、明天那么写。
 */
const BALANCE_CODE = ProviderRuntimeFailurePolicy.accountBalanceInsufficient

describe('运行期余额失败码', () => {
  it('maps 429 + insufficient_quota (a machine code, not prose) to the new code', () => {
    const error = new ChatProtocolFailureError({
      phase: 'response',
      summary: 'You exceeded your current quota',
      httpStatus: 429,
      upstreamCode: 'insufficient_quota'
    })
    expect(resolveProviderRuntimeFailureCode(error)).toBe(BALANCE_CODE)
  })

  it('keeps a plain 429 as provider-request-failed — a rate limit is not a balance problem', () => {
    const error = new ChatProtocolFailureError({
      phase: 'response',
      summary: 'Rate limit reached for requests',
      httpStatus: 429
    })
    expect(resolveProviderRuntimeFailureCode(error)).toBe(ProviderRuntimeFailurePolicy.requestFailed)
  })

  it('does not guess from the wording: the same words without the machine code stay a plain failure', () => {
    // 故意把余额那句话塞进 summary/body：没有机器码就**不**判成欠费。
    const error = new ChatProtocolFailureError({
      phase: 'response',
      summary: 'insufficient_quota',
      httpStatus: 429,
      body: '{"error":{"message":"insufficient_quota - you have no credits remaining"}}'
    })
    expect(resolveProviderRuntimeFailureCode(error)).toBe(ProviderRuntimeFailurePolicy.requestFailed)
  })

  it('treats HTTP 402 as a structured balance signal on its own', () => {
    const error = new ChatProtocolFailureError({ phase: 'response', summary: 'payment required', httpStatus: 402 })
    expect(resolveProviderRuntimeFailureCode(error)).toBe(BALANCE_CODE)
  })

  it('reads the machine code out of the provider body instead of its prose', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'You exceeded your current quota', code: 'insufficient_quota', type: 'insufficient_quota' } }),
      { status: 429 }
    )
    const failure = await readChatProviderFailure(response)
    expect(failure.upstreamCode).toBe('insufficient_quota')
    expect(failure.summary).toBe('You exceeded your current quota')
  })

  it('reads nothing structured out of a body that only has prose', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'insufficient_quota, please recharge' } }), { status: 429 })
    const failure = await readChatProviderFailure(response)
    expect(failure.upstreamCode).toBeUndefined()
  })

  it('carries the code through the assistant failure evidence too', () => {
    const error = new AssistantInvocationFailureError('provider-request-failed', {
      phase: 'response',
      summary: 'billing hard limit reached',
      httpStatus: 429,
      upstreamCode: 'billing_hard_limit_reached'
    })
    expect(resolveProviderRuntimeFailureCode(error)).toBe(BALANCE_CODE)
  })

  it('leaves the model lifecycle codes untouched', () => {
    const retired = new ChatProtocolFailureError({
      phase: 'response',
      summary: 'This model has been retired',
      httpStatus: 429
    })
    expect(resolveProviderRuntimeFailureCode(retired)).toBe(ProviderRuntimeFailurePolicy.modelRetired)
  })
})
