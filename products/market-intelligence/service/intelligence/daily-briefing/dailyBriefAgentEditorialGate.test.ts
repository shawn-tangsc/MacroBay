import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { runEditorialGate } from './dailyBriefAgentEditorialGate'

/**
 * 语言闸门的行为只有三条，全部在这里钉住：
 *
 * 1. 命中 → **一次**修复重写（失败码与首个命中路径进修复提示）；
 * 2. 重写后仍命中 → 这一版按 `invalid-output-language` 失败，**不删段、不翻译**；
 * 3. 没给检查器（例如事实层）→ 行为不变，直接通过。
 */
function harness(checkLanguage?: (document: DailyBriefingDocument) => readonly Readonly<{ path: string }>[]) {
  const repairs: string[] = []
  const runner = {
    continue: vi.fn(async (_sessionId: string, text: string) => {
      repairs.push(text)
      return { assistantText: '{"rewritten":true}', toolInvocations: [] }
    })
  } as unknown as DailyBriefAgentRunner
  const documents: DailyBriefingDocument[] = []
  return {
    repairs,
    input: {
      runner,
      sessionId: 's1',
      written: '{"first":true}',
      maximumRounds: 1,
      toolInvocations: [],
      stage: () => undefined,
      repairPrompt: (code: string, detail: string | undefined) => `repair ${code}${detail ? ` ${detail}` : ''}`,
      validate: (parsed: unknown) => ({ ok: true as const, value: parsed as never }),
      apply: (value: unknown) => {
        const document = { kind: 'document', attempt: documents.length + 1, value } as unknown as DailyBriefingDocument
        documents.push(document)
        return document
      },
      ...(checkLanguage ? { checkLanguage } : {})
    }
  }
}

describe('the editorial gate checks the language of the built document', () => {
  it('repairs once and accepts when the rewrite is in the edition language', async () => {
    let calls = 0
    const test = harness(() => (++calls === 1 ? [{ path: 'conclusion.summary' }] : []))
    const outcome = await runEditorialGate(test.input)
    expect(outcome.state).toBe('accepted')
    // 命中走的是**修复重写**，不是重来一遍；提示里带码与首个路径，模型才知道改哪。
    expect(test.repairs).toEqual(['repair invalid-output-language conclusion.summary'])
  })

  it('fails the edition with the code and the first path when the rewrite is still wrong', async () => {
    const test = harness(() => [{ path: 'conclusion.summary' }])
    const outcome = await runEditorialGate(test.input)
    expect(outcome.state).toBe('failed')
    if (outcome.state !== 'failed') throw new Error('unreachable')
    expect(outcome.failureCode).toBe('invalid-output-language')
    expect(outcome.failureDetail).toBe('conclusion.summary')
    // 只重写一次：没有第二轮的修复，也没有悄悄删段或翻译。
    expect(test.repairs).toHaveLength(1)
  })

  it('leaves the gate unchanged when there is no checker', async () => {
    const test = harness()
    const outcome = await runEditorialGate(test.input)
    expect(outcome.state).toBe('accepted')
    expect(test.repairs).toHaveLength(0)
  })
})
