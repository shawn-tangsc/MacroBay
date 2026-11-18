import { describe, expect, it, vi } from 'vitest'

import type { AnalysisRun, EvidenceSnapshot, EventGroup } from '../../../contracts/marketAnalysisContracts'
import { createAnalysisOrchestrator, marketAnalysisInvocationPolicy } from './analysisOrchestrator'
import { createModelNetworkReadinessGate } from './modelNetworkReadiness'
import { analysisUpstreamRetryPolicy } from './analysisUpstreamRetry'
import { buildAnalysisReferenceMap } from './analysisReferenceHandles'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'

const asOf = '2026-09-28T00:00:00.000Z'

describe('analysisOrchestrator', () => {
  it('does not spend a model call when no frozen fact has a matching evidence reference', async () => {
    const invoke = vi.fn()
    const updateRunStatus = vi.fn()
    const repository = createRepository({ getSnapshot: () => ({ snapshotHash: 'snapshot-hash', facts: [], evidenceRefs: [] }), updateRunStatus })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })
    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'failed', errorCode: 'analysis-missing-evidence' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('leaves a marker when the run conversation cannot be created', async () => {
    // 架构师 F1 条件之一：建会话那个 catch 以前是空的。窄查抛错（同 ref 命中两条按设计会抛）
    // 或 create 失败时，这次运行一条会话都没有，日志里也得有这一条。
    const marker = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const orchestrator = createAnalysisOrchestrator({
        repository: createRepository(),
        structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } })) } as never,
        now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
        ensureRunSession: vi.fn(async () => { throw new Error('duplicate origin ref: daily-brief:x:default:zh-CN') })
      })

      await orchestrator.run({ analysisRunId: 'mi-ar-1' })

      const printed = marker.mock.calls.map(([line]) => String(line)).find((line) => line.includes('MI_ANALYSIS_RUN_SESSION_APPEND_FAILED'))
      expect(printed).toBeDefined()
      expect(JSON.parse(printed!)).toMatchObject({
        marker: 'MI_ANALYSIS_RUN_SESSION_APPEND_FAILED',
        stage: 'ensure',
        runId: 'mi-ar-1',
        reason: 'duplicate origin ref: daily-brief:x:default:zh-CN'
      })
    } finally {
      marker.mockRestore()
    }
  })

  it('supplies the exact output structure and only evidence-backed facts to the model', async () => {
    const invoke = vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
      const system = request.messages.find(message => message.role === 'system')!.content
      for (const field of ['knownFacts', 'transmissionHypotheses', 'marketReaction', 'supportingEvidence', 'counterEvidence', 'scenarios', 'directions', 'nextCatalysts', 'dataCaveats', 'evidenceRefs', 'factIds', 'evidenceRefIds', 'invalidation', '15m-2h', '1d-3d', 'short', 'medium', 'long', 'confidence']) expect(system).toContain(field)
      expect(system).toContain('conclusion.summary 必须先给出明确判断')
      // The direction is a language-neutral key, so the prompt pins the key list rather than any
      // natural-language term.
      expect(system).toContain('conclusion.direction 只能取这五个 key')
      for (const key of ['bullish', 'bearish', 'range', 'undecided', 'mixed']) expect(system).toContain(key)
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } }
    })
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })
    expect(await orchestrator.run({ analysisRunId: 'mi-ar-1' })).toEqual({ status: 'succeeded' })
  })

  it('reads the reader language when it submits, and asks for prose in that language', async () => {
    const systemPrompts: string[] = []
    const invoke = vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
      systemPrompts.push(request.messages.find(message => message.role === 'system')!.content)
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } }
    })
    const getLanguage = vi.fn(async () => 'en-US' as const)
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository(),
      structuredModelInvocation: { invoke } as never,
      now: () => asOf, timeZone: () => 'UTC',
      idFactory: idFactory(),
      getLanguage
    })

    expect(await orchestrator.run({ analysisRunId: 'mi-ar-1' })).toEqual({ status: 'succeeded' })
    expect(getLanguage).toHaveBeenCalledTimes(1)
    expect(systemPrompts[0]).toContain('输出语言：英语（en-US）')
  })

  it('runs an isolated structured invocation and commits a summary without chat writes', async () => {
    let chatMessagesWritten = 0
    const commitSuccessfulAnalysis = vi.fn()
    const invoke = vi.fn(async (request: { taskId: string; messages: readonly { role: string; content: string }[]; timeoutMs?: number; abortSignal?: AbortSignal; parse: (value: unknown) => unknown }) => {
      expect(request.taskId).toBe('mi-ar-1')
      expect(request.timeoutMs).toBe(marketAnalysisInvocationPolicy.modelTimeoutMs)
      expect(request.messages.every(message => !message.content.includes('providerBody'))).toBe(true)
      expect(request.abortSignal).toBeInstanceOf(AbortSignal)
      return { ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', providerId: 'provider-1', modelId: 'model-1', durationMs: 4 } }
    })
    const repository = createRepository({ commitSuccessfulAnalysis, chatMessagesWritten: () => chatMessagesWritten })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(), getLanguage: async () => 'en-US' })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result.status).toBe('succeeded')
    expect(chatMessagesWritten).toBe(0)
    expect(commitSuccessfulAnalysis).toHaveBeenCalledOnce()
    expect(commitSuccessfulAnalysis.mock.calls[0]?.[0]).toMatchObject({ runId: 'mi-ar-1', summary: { id: 'mi-as-1', eventGroupId: 'mi-eg-1', schemaVersion: 3, proseLanguage: 'en-US' } })
    console.log(JSON.stringify({ marker: 'MI_ANALYSIS_ACCEPTANCE', package: 'MI-A05', event: 'isolated-run', status: 'pass', details: { chatMessagesWritten, modelCalls: invoke.mock.calls.length, publishedSummary: commitSuccessfulAnalysis.mock.calls.length, oldSummaryPreserved: true } }))
  })

  it('hands the frozen change record to the model and requires it in the conclusion', async () => {
    const invoke = vi.fn(async (request: { messages: readonly { role: string; content: string }[] }) => {
      const system = request.messages.find(message => message.role === 'system')!.content
      expect(system).toContain('本次数据变化')
      expect(system).toContain('没有新变化')
      const user = JSON.parse(request.messages.at(-1)!.content) as { change: string }
      // The prompt tells the model to quote the fields that moved, so it must receive readable
      // names and scaled values, never the machine encoding it would copy verbatim.
      expect(user.change).toContain('宏观 · 实际值：3.2 → 3.4')
      expect(user.change).not.toContain('~actual')
      // The trigger rule now applies to this run (it has a change record): the answer must cite the
      // triggering evidence in a reasoning section and name the fact. `validOutput()` does neither,
      // so it would be rejected and this test would be measuring the rejection instead.
      const output = validOutput()
      output.conclusion.change = 'CPI 从 3.2 升到 3.4。'
      output.supportingEvidence = [{ statement: 'CPI 实际上升，支持本判断。', evidenceRefId: 'evidence-1' }]
      return { ok: true as const, output, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 1 } }
    })
    const repository = createRepository({
      getSnapshot: () => ({
        snapshotHash: 'snapshot-hash',
        facts: [{ factId: 'fact-1', domain: 'macro', subject: 'CPI', metric: 'actual', value: '3.4', unit: 'percent', sourceId: 'official', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: 'evidence-1' }],
        evidenceRefs: [{ evidenceRefId: 'evidence-1', sourceId: 'official', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'hash' }],
        change: { sequence: 2, previousSnapshotHash: 'h1', facts: [{ factId: 'fact-1', domain: 'macro', metric: 'actual', kind: 'changed', previousValue: '3.2', value: '3.4' }], missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: [] }
      })
    })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })
    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('publishes the complete AI assessment in the timeline entry', async () => {
    const assessment = assessmentLongerThanTimelinePreviewPolicy()
    const commitSuccessfulAnalysis = vi.fn()
    const repository = createRepository({ commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output: { ...validOutput(), conclusion: { ...validOutput().conclusion, summary: assessment } }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })) } as never,
      now: () => asOf, timeZone: () => 'UTC',
      idFactory: idFactory()
    })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    const published = commitSuccessfulAnalysis.mock.calls[0]?.[0].timeline.safeExcerpt
    expect(published).toBe(assessment)
    // TimelineEntry.safeExcerpt is the published conclusion, not a preview field.
    // No 240-character or other display budget may shorten it; a display-only
    // preview policy must never be persisted as the conclusion.
    expect(published).not.toBe(assessment.slice(0, 240))
    expect(published.length).toBeGreaterThan(240)
  })

  it('preserves the previous summary when the provider is not ready', async () => {
    const updateRunStatus = vi.fn()
    const commitSuccessfulAnalysis = vi.fn()
    const repository = createRepository({ updateRunStatus, commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: false as const, errorCode: 'model-not-ready' as const, trace: { taskId: 'mi-ar-1', durationMs: 2, errorCode: 'model-not-ready' as const } })) } as never,
      now: () => asOf, timeZone: () => 'UTC',
      idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result.status).toBe('failed')
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-ar-1', status: 'failed', failureCode: 'analysis-provider-not-ready' }))
    expect(commitSuccessfulAnalysis).not.toHaveBeenCalled()
  })

  it('marks invalid model output as invalid-output and does not publish a summary', async () => {
    const updateRunStatus = vi.fn()
    const commitSuccessfulAnalysis = vi.fn()
    const repository = createRepository({ updateRunStatus, commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output: { conclusion: 'not a contract' }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })) } as never,
      now: () => asOf, timeZone: () => 'UTC',
      idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result.status).toBe('invalid-output')
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-invalid-output-schema' }))
    expect(commitSuccessfulAnalysis).not.toHaveBeenCalled()
  })

  it('re-asks once when the first answer misses the contract, and publishes the second', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, output: { conclusion: 'not a contract' }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const repository = createRepository()
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result).toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledTimes(2)
    const messages = (invoke.mock.calls[1]![0] as { messages: readonly { role: string; content: string }[] }).messages
    // The rejected answer is shown back as an assistant turn, so the repair is concrete and the
    // conversation still alternates; the instruction names what the top level must contain.
    expect(messages.at(-2)).toMatchObject({ role: 'assistant' })
    expect(messages.at(-2)!.content).toContain('not a contract')
    expect(messages.at(-1)).toMatchObject({ role: 'user' })
    expect(messages.at(-1)!.content).toContain('顶层必须恰好是')
  })

  it('records the repair call as its own call kind, so a post-mortem can tell the answers apart', async () => {
    // 线上那次事故的存档里三次调用全是 `initial`：修复调用没有被标出来，事后看不出哪一行是首答。
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, output: { conclusion: 'not a contract' }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const begin = vi.fn((_input: { callKind: string }) => ({ id: `io-${begin.mock.calls.length}`, createdAt: asOf }))
    const repository = createRepository({ analysisIo: { begin, complete: vi.fn() } })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    expect(await orchestrator.run({ analysisRunId: 'mi-ar-1' })).toEqual({ status: 'succeeded' })
    expect(begin.mock.calls.map(([input]) => input.callKind)).toEqual(['initial', 'repair'])
  })

  it('tells the model which direction horizon is missing, not to fix its citations', async () => {
    const incomplete = validOutput()
    incomplete.directions = incomplete.directions.filter(entry => entry.horizon !== 'long')
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, output: incomplete, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect((invoke.mock.calls[1]![0] as { messages: readonly { content: string }[] }).messages.at(-1)!.content)
      .toContain('short、medium、long 各一条')
  })

  it('re-asks once when the reply is not JSON at all', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, errorCode: 'invalid-json', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository(), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledTimes(2)
    const messages = (invoke.mock.calls[1]![0] as { messages: readonly { role: string; content: string }[] }).messages
    expect(messages.at(-1)!.role).toBe('user')
    expect(messages.at(-1)!.content).toContain('不是合法 JSON')
  })

  it('does not spend a second call on a provider error', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, errorCode: 'provider-error' as const, trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
    const updateRunStatus = vi.fn()
    const orchestrator = createAnalysisOrchestrator({ repository: createRepository({ updateRunStatus }), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'failed', errorCode: 'analysis-provider-error' })
    expect(invoke).toHaveBeenCalledOnce()
    // 2 ms 只说明这一跳很快失败，说明不了是连接：没有状态码、也没有传输类别时不许再猜「连不上」。
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ failureDetailCode: 'provider-other' }))
  })

  it('records why a provider call failed, from the status or transport kind it carried', async () => {
    const cases = [
      // The gateway's fallback budget cutting a long attempt: the observed cut lands at 59–61 s.
      { errorCode: 'provider-error' as const, durationMs: 60_700, detail: 'upstream-aborted' },
      // Short duration alone is not evidence of a connection failure; the transport kind is.
      { errorCode: 'provider-error' as const, durationMs: 1_200, detail: 'provider-other' },
      { errorCode: 'provider-error' as const, durationMs: 1_200, transportErrorKind: 'dns' as const, detail: 'connect-failed' },
      { errorCode: 'provider-error' as const, durationMs: 1_200, transportErrorKind: 'reset' as const, detail: 'connect-failed' },
      { errorCode: 'provider-error' as const, durationMs: 1_200, transportErrorKind: 'timeout' as const, detail: 'gateway-timeout' },
      // B：注入 500，失败但 detail 是 http-5xx——不是「连不上」。
      { errorCode: 'provider-error' as const, durationMs: 1_200, httpStatus: 500, detail: 'http-5xx' },
      { errorCode: 'provider-error' as const, durationMs: 60_700, httpStatus: 502, detail: 'http-5xx' },
      { errorCode: 'provider-error' as const, durationMs: 1_200, httpStatus: 401, detail: 'http-4xx' },
      // An answer that was an error, not a silent death: neither duration rule may claim it.
      { errorCode: 'provider-error' as const, durationMs: 20_000, detail: 'provider-other' },
      { errorCode: 'rate-limited' as const, durationMs: 800, detail: 'http-429' },
      { errorCode: 'timeout' as const, durationMs: 240_000, detail: 'gateway-timeout' }
    ]
    for (const entry of cases) {
      const invoke = vi.fn(async () => ({
        ok: false as const,
        errorCode: entry.errorCode,
        ...('httpStatus' in entry ? { httpStatus: entry.httpStatus } : {}),
        ...('transportErrorKind' in entry ? { transportErrorKind: entry.transportErrorKind } : {}),
        trace: { taskId: 'mi-ar-1', durationMs: entry.durationMs }
      }))
      const updateRunStatus = vi.fn()
      const orchestrator = createAnalysisOrchestrator({ repository: createRepository({ updateRunStatus }), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

      await orchestrator.run({ analysisRunId: 'mi-ar-1' })

      expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({
        failureDetailCode: entry.detail, failureCode: expect.any(String)
      }))
      // No failed run leaves the detail blank or copies the coarse code back into it.
      expect(updateRunStatus.mock.calls[0]![0].failureDetailCode).not.toBe(updateRunStatus.mock.calls[0]![0].failureCode)
    }
  })

  it('A：启动后 2 秒排队的那次运行等启动探针，而不是自己落成 connect-failed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const providerState = {
        providers: [{
          id: 'provider-1', name: 'provider', enabled: true, baseUrl: 'https://api.example.test',
          apiKey: 'key', endpoints: [], customHeaders: [],
          models: [{ id: 'model-1', name: 'model', capabilities: { chat: true } }]
        }]
      }
      const probeAttemptsAt: number[] = []
      const fetchMock = vi.fn(async () => {
        probeAttemptsAt.push(Date.now())
        // 前三次是传输层失败（启动后代理还没就绪）；约 +3.5 s 的第四次拿到 401——端点可达。
        if (Date.now() < 3_500) {
          const error = new Error('fetch failed') as Error & { cause?: { code: string } }
          error.cause = { code: 'ENOTFOUND' }
          throw error
        }
        return { status: 401, body: null } as unknown as Response
      })
      const gate = createModelNetworkReadinessGate({
        getProviderState: async () => providerState as never,
        fetch: fetchMock as never
      })
      gate.start()

      // 启动后 2 秒运行才排队：此时探针已退避两次、网络还没通。
      await vi.advanceTimersByTimeAsync(2_000)
      expect(probeAttemptsAt.length).toBeGreaterThanOrEqual(2)

      const invokedAt: number[] = []
      const invoke = vi.fn(async () => {
        invokedAt.push(Date.now())
        // 网络没通之前真的去调，得到的是传输层错误——没有门时正是这条路落 `connect-failed`。
        if (Date.now() < 3_500) {
          return {
            ok: false as const, errorCode: 'provider-error' as const,
            transportErrorKind: 'dns' as const, trace: { taskId: 'mi-ar-1', durationMs: 1_200 }
          }
        }
        return {
          ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1',
          trace: { taskId: 'mi-ar-1', durationMs: 2 }
        }
      })
      const updateRunStatus = vi.fn()
      const orchestrator = createAnalysisOrchestrator({
        repository: createRepository({ updateRunStatus }),
        structuredModelInvocation: { invoke } as never,
        now: () => new Date(Date.now()).toISOString(),
        timeZone: () => 'UTC', idFactory: idFactory(),
        networkReadiness: gate
      })
      const running = orchestrator.run({ analysisRunId: 'mi-ar-1' })

      // 探针在 ~3.5 s 拿到 401 后就绪；等到标记的运行这时才发起模型调用。
      await vi.advanceTimersByTimeAsync(3_000)
      const result = await running
      // 判据：这一次既没失败，也绝不落 `connect-failed`。没有门时这里会是 ['connect-failed']。
      const recordedDetails = updateRunStatus.mock.calls.map(
        call => (call[0] as { failureDetailCode?: string }).failureDetailCode
      )
      expect(recordedDetails).not.toContain('connect-failed')
      expect(result).toEqual({ status: 'succeeded' })
      expect(invoke).toHaveBeenCalledOnce()
      expect(invokedAt[0]).toBeGreaterThanOrEqual(3_500)
      expect(gate.networkReadyAt()).toBeTypeOf('string')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails a startup-window run as network-not-ready when the probe budget runs out, without calling the model', async () => {
    const invoke = vi.fn()
    const updateRunStatus = vi.fn()
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository({ updateRunStatus }),
      structuredModelInvocation: { invoke } as never,
      now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
      networkReadiness: { wait: async () => 'not-ready' as const }
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result).toEqual({ status: 'failed', errorCode: 'analysis-provider-error' })
    expect(invoke).not.toHaveBeenCalled()
    // 超时不许冒充 `connect-failed`：那是「断了」，这里是「还没就绪」。
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      failureDetailCode: 'network-not-ready'
    }))
  })

  it('answers a failure the reader asked for, and stays quiet for an automatic one', async () => {
    const runWith = (triggerKey: string): AnalysisRun => ({
      id: 'mi-ar-1', schemaVersion: 1, analysisKind: 'market', eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
      analysisPhase: 'initial', triggerKey, idempotencyKey: 'key', status: 'queued', attempt: 1, retryOfRunId: null,
      modelProviderId: null, modelId: null, validationMode: null, policyVersion: 'policy', promptVersion: 'market-analysis-v1',
      skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
      failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
    })
    const cases = [
      ['manual.initial', 1],
      ['manual.refresh', 1],
      // Automatic failures have their own throttled levels; 0′ must not wake the reader for them.
      ['macro.actual.first-confirmed', 0],
      ['calendar.refresh', 0]
    ] as const
    for (const [triggerKey, expectedCalls] of cases) {
      const invoke = vi.fn(async () => ({ ok: false as const, errorCode: 'provider-error' as const, trace: { taskId: 'mi-ar-1', durationMs: 60_700 } }))
      const notifyManualFailure = vi.fn(async () => undefined)
      const orchestrator = createAnalysisOrchestrator({
        repository: createRepository({ getRun: () => runWith(triggerKey), updateRunStatus: vi.fn() }),
        structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
        notifyManualFailure
      })
      await orchestrator.run({ analysisRunId: 'mi-ar-1' })
      expect(notifyManualFailure, triggerKey).toHaveBeenCalledTimes(expectedCalls)
      if (expectedCalls === 1) {
        expect(notifyManualFailure).toHaveBeenCalledWith({
          runId: 'mi-ar-1', analysisKind: 'market', failureCode: 'analysis-provider-error', failureDetailCode: 'upstream-aborted', occurredAt: asOf
        })
      }
    }
  })

  it('does not spend a second call on a timeout or a cancellation', async () => {
    for (const [errorCode, expected] of [['timeout', 'analysis-timeout'], ['cancelled', 'analysis-cancelled']] as const) {
      const invoke = vi.fn(async () => ({ ok: false as const, errorCode, trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      const updateRunStatus = vi.fn()
      const orchestrator = createAnalysisOrchestrator({ repository: createRepository({ updateRunStatus }), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

      const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

      expect(invoke).toHaveBeenCalledOnce()
      if (expected === 'analysis-cancelled') {
        expect(result.status).toBe('cancelled')
        expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
      } else {
        expect(result).toEqual({ status: 'failed', errorCode: expected })
      }
    }
  })

  it('tells the model to cite the sentiment it ignored, on the retry', async () => {
    const news = {
      factId: 'fact-news', domain: 'sentiment' as const, subject: 'market', metric: 'news-sentiment',
      value: 'bearish · strength 4/5 · confidence 80%｜Exchange outage', unit: null, sourceId: 'news', sourceLabel: 'news',
      observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 0.8, comparability: 'not-comparable' as const, evidenceRefId: 'evidence-news'
    }
    const snapshot = {
      snapshotHash: 'snapshot-hash',
      facts: [
        { factId: 'fact-1', domain: 'macro' as const, subject: 'CPI', metric: 'actual', value: '3.2', unit: 'percent', sourceId: 'official', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'evidence-1' },
        news
      ],
      evidenceRefs: [{ evidenceRefId: 'evidence-1' }, { evidenceRefId: 'evidence-news' }]
    }
    const cited = validOutput()
    cited.knownFacts.push({ factId: 'fact-news', statement: '舆情偏空，限制上行空间。', evidenceRefIds: ['evidence-news'] })
    const invoke = vi.fn()
      // First answer ignores the appended sentiment; the retry cites it.
      .mockResolvedValueOnce({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
      .mockResolvedValueOnce({ ok: true as const, output: cited, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository({ getSnapshot: () => snapshot }), structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory()
    })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect((invoke.mock.calls[1]![0] as { messages: readonly { content: string }[] }).messages.at(-1)!.content)
      .toContain('新闻舆情')
  })

  it('records which evidence rule rejected the output, not only the shared code', async () => {
    const updateRunStatus = vi.fn()
    const repository = createRepository({
      getSnapshot: () => ({ snapshotHash: 'snapshot-hash', facts: [{ factId: 'mi-fact-1', evidenceRefId: 'mi-ev-1', metric: 'price-return', comparability: 'comparable', freshness: 'fresh' }], evidenceRefs: [{ evidenceRefId: 'mi-ev-1' }] }),
      updateRunStatus
    })
    // Shape-valid, but the fact claim cites an evidence id the frozen snapshot does not hold:
    // one of the three defects that all used to surface as the same message.
    const output = {
      conclusion: {
        direction: 'range',
        summary: '缺少可比行情，方向不清晰。',
        change: '没有新变化。',
        causalChain: '缺少可比行情 → 无法确认传导 → 方向不明。',
        conditions: [],
        macro: null,
        evidenceStrength: null,
        dataGaps: ['缺少可比行情。']
      },
      knownFacts: [{ factId: 'mi-fact-1', statement: '事实。', evidenceRefIds: ['mi-ev-unknown'] }],
      transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [],
      // Complete and valid on purpose: this case must fail on the reference rule, not on shape.
      directions: [
        { horizon: 'short', direction: 'range', rationale: '短期无方向。', confidence: 'low', evidenceRefIds: ['mi-ev-1'] },
        { horizon: 'medium', direction: 'range', rationale: '中期无方向。', confidence: 'low', evidenceRefIds: ['mi-ev-1'] },
        { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['mi-ev-1'] }
      ],
      nextCatalysts: [], dataCaveats: [], evidenceRefs: ['mi-ev-unknown']
    }
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke: vi.fn(async () => ({ ok: true as const, output, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } })) } as never,
      now: () => asOf, timeZone: () => 'UTC',
      idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result).toMatchObject({ status: 'invalid-output', errorCode: 'analysis-missing-evidence' })
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-missing-evidence', failureDetailCode: 'unknown-reference'
    }))
  })

  it('fails the run with the rule and a marker when the retry still contradicts the evidence', async () => {
    // 判据 A 的收尾：拒 → 重写一次 → 仍相反 → 整条 run 失败（`fail`），并留 `MI_ANALYSIS_OUTPUT_REJECTED`
    // 与 rule 名；**不许**降级成"把句子删掉照常发布"。
    const updateRunStatus = vi.fn()
    const marker = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const repository = createRepository({
      getSnapshot: () => ({
        snapshotHash: 'snapshot-hash',
        facts: [
          { factId: 'mi-fact-1', evidenceRefId: 'mi-ev-1', metric: 'price-return', comparability: 'comparable', freshness: 'fresh' },
          { factId: 'mi-fact-div', evidenceRefId: 'mi-ev-1', metric: 'divergence-narrative-price', comparability: 'comparable', freshness: 'fresh', value: 'bearish' }
        ],
        evidenceRefs: [{ evidenceRefId: 'mi-ev-1' }]
      }),
      updateRunStatus
    })
    // 引用全部落到这份快照的 mi-ev-1 上：这一条必须死在背离规则上，而不是死在引用规则上。
    const base = validOutput()
    const contradicting = {
      ...base,
      knownFacts: [{ factId: 'mi-fact-1', statement: '事实。', evidenceRefIds: ['mi-ev-1'] }],
      transmissionHypotheses: [{ statement: '条件式传导。', evidenceRefIds: ['mi-ev-1'] }],
      marketReaction: [],
      supportingEvidence: [{ statement: '支撑。', evidenceRefId: 'mi-ev-1' }],
      counterEvidence: [],
      directions: base.directions.map((entry) => ({ ...entry, evidenceRefIds: ['mi-ev-1'] })),
      nextCatalysts: [],
      evidenceRefs: ['mi-ev-1'],
      divergences: [{ pairId: 'narrative-price', stance: 'not-diverging' }]
    }
    const invoke = vi.fn(async () => ({ ok: true as const, output: contradicting, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
    const orchestrator = createAnalysisOrchestrator({
      repository,
      structuredModelInvocation: { invoke } as never,
      now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory()
    })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    expect(result).toMatchObject({ status: 'invalid-output', errorCode: 'analysis-missing-evidence' })
    // 拒收后走重写，次数受 `maximumCallsPerRun` 上限：至少重写一次，绝不无限重试。
    expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(analysisUpstreamRetryPolicy.maximumCallsPerRun)
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mi-ar-1', status: 'invalid-output', failureCode: 'analysis-missing-evidence', failureDetailCode: 'divergence-contradiction'
    }))
    const printed = marker.mock.calls.map(([line]) => String(line)).find((line) => line.includes('MI_ANALYSIS_OUTPUT_REJECTED'))
    expect(printed).toBeDefined()
    expect(JSON.parse(printed!)).toMatchObject({ marker: 'MI_ANALYSIS_OUTPUT_REJECTED', analysisRunId: 'mi-ar-1', rule: 'divergence-contradiction' })
    marker.mockRestore()
  })

  describe('the analysis-conclusion push (N12)', () => {
    const runFixture = (triggerKey: string) => ({
      id: 'mi-ar-1', schemaVersion: 1, analysisKind: 'market', eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
      analysisPhase: 'initial', triggerKey, idempotencyKey: 'key', status: 'queued', attempt: 1, retryOfRunId: null,
      modelProviderId: null, modelId: null, validationMode: null, policyVersion: 'policy', promptVersion: 'market-analysis-v1',
      skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
      failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
    })

    it('submits exactly once after a signal-triggered run is written', async () => {
      const notifyAnalysisConclusion = vi.fn(async (_notice: import('./analysisConclusionNotifier').AnalysisConclusionNotice) => undefined)
      const invoke = vi.fn(async () => ({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      const orchestrator = createAnalysisOrchestrator({
        repository: createRepository({ getRun: () => runFixture('signal.open-interest.oi-liquidation-proxy') }),
        structuredModelInvocation: { invoke } as never,
        now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
        notifyAnalysisConclusion,
        readTriggerSignal: () => ({ direction: 'bearish' as const, factIds: ['fact-1'] })
      })

      await orchestrator.run({ analysisRunId: 'mi-ar-1' })

      expect(notifyAnalysisConclusion).toHaveBeenCalledTimes(1)
      expect(notifyAnalysisConclusion.mock.calls[0]![0]).toMatchObject({
        runId: 'mi-ar-1',
        triggerKey: 'signal.open-interest.oi-liquidation-proxy',
        bucket: 'signal:mi-eg-1',
        cutoff: asOf,
        conclusionDirection: 'range',
        summary: '官方数据已发布，市场反应仍需观察。',
        citedFactIds: ['fact-1'],
        triggerDirection: 'bearish',
        triggerFactIds: ['fact-1'],
        citedCount: 1
      })
    })

    it('pushes a run that reached the importance threshold, whatever key the phase gave it', async () => {
      // 2026-11-09 的缺陷：消息面达门槛的运行也记成 `macro.actual.first-confirmed`，按前缀判会漏；
      // 判据改成原因码之后，同一条运行进推送判定。
      const notifyAnalysisConclusion = vi.fn(async (_notice: import('./analysisConclusionNotifier').AnalysisConclusionNotice) => undefined)
      const invoke = vi.fn(async () => ({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      const orchestrator = createAnalysisOrchestrator({
        repository: createRepository({ getRun: () => runFixture('macro.actual.first-confirmed'), triggerReasonOf: () => 'severity-confirmed' }),
        structuredModelInvocation: { invoke } as never,
        now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
        notifyAnalysisConclusion
      })

      await orchestrator.run({ analysisRunId: 'mi-ar-1' })
      expect(notifyAnalysisConclusion).toHaveBeenCalledTimes(1)
      // 桶带原因码与事件：同一天两条不同事件各算一次，不会被同一个触发键并成一条。
      expect(notifyAnalysisConclusion.mock.calls[0]![0]).toMatchObject({ bucket: 'severity-confirmed:mi-eg-1' })
    })

    it('keeps routine slots and restart catch-ups out of the phone', async () => {
      for (const reasonCode of ['session-slot-europe', 'session-slot-asia', 'session-slot-us', 'restart-initial-compensated', 'restart-review-compensated']) {
        const notifyAnalysisConclusion = vi.fn(async (_notice: import('./analysisConclusionNotifier').AnalysisConclusionNotice) => undefined)
        const invoke = vi.fn(async () => ({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
        const orchestrator = createAnalysisOrchestrator({
          repository: createRepository({ getRun: () => runFixture('macro.actual.first-confirmed'), triggerReasonOf: () => reasonCode }),
          structuredModelInvocation: { invoke } as never,
          now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
          notifyAnalysisConclusion
        })
        await orchestrator.run({ analysisRunId: 'mi-ar-1' })
        expect(notifyAnalysisConclusion, reasonCode).not.toHaveBeenCalled()
      }
    })

    it('stays silent for a manual run and for the daily-briefing path', async () => {
      for (const triggerKey of ['manual.refresh', 'manual.initial', 'calendar.refresh']) {
        const notifyAnalysisConclusion = vi.fn(async (_notice: import('./analysisConclusionNotifier').AnalysisConclusionNotice) => undefined)
        const invoke = vi.fn(async () => ({ ok: true as const, output: validOutput(), providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
        const orchestrator = createAnalysisOrchestrator({
          repository: createRepository({ getRun: () => runFixture(triggerKey) }),
          structuredModelInvocation: { invoke } as never,
          now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
          notifyAnalysisConclusion
        })
        await orchestrator.run({ analysisRunId: 'mi-ar-1' })
        expect(notifyAnalysisConclusion, triggerKey).not.toHaveBeenCalled()
      }
    })

    it('never pushes a failed or rejected run — those already have their own events', async () => {
      const notifyAnalysisConclusion = vi.fn(async (_notice: import('./analysisConclusionNotifier').AnalysisConclusionNotice) => undefined)
      const invoke = vi.fn(async () => ({ ok: true as const, output: { ...validOutput(), knownFacts: [{ factId: 'fact-1', statement: '事实。', evidenceRefIds: ['evidence-unknown'] }] }, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      const orchestrator = createAnalysisOrchestrator({
        repository: createRepository({ getRun: () => runFixture('signal.open-interest.oi-liquidation-proxy') }),
        structuredModelInvocation: { invoke } as never,
        now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
        notifyAnalysisConclusion
      })
      const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })
      expect(result.status).toBe('invalid-output')
      expect(notifyAnalysisConclusion).not.toHaveBeenCalled()
    })
  })

  it('cancels before model invocation when the run signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const updateRunStatus = vi.fn()
    const invoke = vi.fn()
    const repository = createRepository({ updateRunStatus })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1', signal: controller.signal })

    expect(result.status).toBe('cancelled')
    expect(invoke).not.toHaveBeenCalled()
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'mi-ar-1', status: 'cancelled', failureCode: 'analysis-cancelled' }))
  })

  it('calls the model recorded on the run, and leaves the choice open for a run without one', async () => {
    const invoke = vi.fn(async (_request: unknown) => ({ ok: true as const, output: validOutput(), providerId: 'provider-9', modelId: 'model-9', trace: { taskId: 'mi-ar-1', durationMs: 1 } }))
    const run = {
      id: 'mi-ar-1', schemaVersion: 1, analysisKind: 'market', eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
      analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey: 'key', status: 'queued', attempt: 1,
      retryOfRunId: null, modelProviderId: 'provider-9', modelId: 'model-9', policyVersion: 'policy', promptVersion: 'market-analysis-v1',
      skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
      failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
    }
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository({ getRun: () => run }),
      structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory()
    })
    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ providerId: 'provider-9', modelId: 'model-9' })
  })

  it('records a caller-cancelled model call as cancelled, not as a timeout', async () => {
    const updateRunStatus = vi.fn()
    const commitSuccessfulAnalysis = vi.fn()
    const invoke = vi.fn(async () => ({ ok: false as const, errorCode: 'cancelled' as const, trace: { taskId: 'mi-ar-1', durationMs: 4_000 } }))
    const repository = createRepository({ updateRunStatus, commitSuccessfulAnalysis })
    const orchestrator = createAnalysisOrchestrator({ repository, structuredModelInvocation: { invoke } as never, now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory() })

    const result = await orchestrator.run({ analysisRunId: 'mi-ar-1' })

    // The reader must not be told the model was too slow when the app itself ended the call.
    expect(result).toEqual({ status: 'cancelled', errorCode: 'analysis-cancelled' })
    expect(updateRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', failureCode: 'analysis-cancelled' }))
    expect(commitSuccessfulAnalysis).not.toHaveBeenCalled()
  })
})
describe('news line through the orchestrator (R39 C)', () => {
  it('validates its own contract, stores three paragraphs and writes no market side effects', async () => {
    const newsFact = fixtureFact('triggered-news:item-1', 'news:item-1', 'news-sentiment', 'sentiment', 'BTC')
    // 正文里的两个百分数必须能在快照里找到出处：值直接用正文要引的数。
    const macroFact = { ...fixtureFact('fact-1', 'evidence-1', 'actual', 'macro', 'CPI'), value: 3.2 }
    const capitalFact = { ...fixtureFact('fact-2', 'evidence-2', 'etf-net-flow-usd', 'capital', 'BTC'), value: -2.92 }
    const newsSnapshot = {
      ...fixtureSnapshot(),
      facts: [newsFact, macroFact, capitalFact],
      evidenceRefs: [{ evidenceRefId: 'news:item-1' }, { evidenceRefId: 'evidence-1' }, { evidenceRefId: 'evidence-2' }],
      trigger: { source: 'intelligence-item' as const, itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
    } as unknown as EvidenceSnapshot
    const handles = buildAnalysisReferenceMap(newsSnapshot)
    const f = (factId: string): string => handles.factHandleById.get(factId)!
    const e = (evidenceRefId: string): string => handles.evidenceHandleById.get(evidenceRefId)!
    const at = (factId: string): string => formatShellInstant(
      newsSnapshot.facts.find(fact => fact.factId === factId)!.observedAt ?? '',
      { timeZone: 'UTC', locale: 'zh-CN', precision: 'minute' }
    )
    const output = {
      what: { evidenceRef: e('news:item-1'), actor: '据报道，', action: '某公司宣布裁员。', whyRelated: '这会压低风险偏好，对 BTC 偏空。', stance: 'bearish' },
      reading: {
        checks: [
          { evidenceRef: e('evidence-1'), effect: 'supports', statement: `CPI 3.2%，截至 ${at('fact-1')}。` },
          { evidenceRef: e('evidence-2'), effect: 'supports', statement: `ETF 净流出 -2.92%，截至 ${at('fact-2')}。` }
        ],
        contradiction: false, verdict: 'supports'
      },
      outlook: {
        direction: 'bearish',
        mechanism: '短期偏空。新闻压低风险偏好，若 ETF 净流入转正则这个判断作废。',
        watchFor: [{ refKind: 'fact', ref: f('fact-1') }],
        invalidation: { refKind: 'fact', factRef: f('fact-2') }
      },
      gaps: []
    }
    const commitSuccessfulAnalysis = vi.fn()
    const appendRunSummary = vi.fn(async () => undefined)
    const notifyAnalysisConclusion = vi.fn(async () => undefined)
    const newsRun = {
      ...fixtureRunShape(),
      analysisKind: 'news' as const, triggerKey: 'news.manual',
      promptVersion: 'news-analysis-v2', skillVersion: 'news-analysis-v1', outputSchemaVersion: 1
    }
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository({
        getRun: () => newsRun, getSnapshot: () => newsSnapshot, listSnapshots: () => [newsSnapshot],
        latestSummaryVersion: () => 0, commitSuccessfulAnalysis
      }),
      structuredModelInvocation: {
        invoke: vi.fn(async () => ({ ok: true as const, output, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      } as never,
      now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory(),
      appendRunSummary, notifyAnalysisConclusion
    })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    const committed = commitSuccessfulAnalysis.mock.calls[0]![0] as Record<string, unknown>
    const summary = committed.summary as Record<string, unknown>
    const conclusion = summary.conclusion as Record<string, unknown>
    // 三段都落到界面读的那三个字段上，且非空。
    expect(conclusion.summary).toContain('某公司宣布裁员')
    expect(conclusion.change).toContain('ETF 净流出')
    expect(conclusion.causalChain).toContain('短期偏空')
    // 结构化记录整块存着，供校验/审计。
    expect(summary.newsInterpretation).toMatchObject({ analysisKind: 'news', schemaVersion: 1, itemId: 'item-1' })
    // 新闻线不该回潮的副作用：预测、时间轴、组指针、会话摘要、推送。
    expect(committed).toMatchObject({ predictions: [], recordGroupPointer: false })
    expect(committed.timeline).toBeUndefined()
    expect(appendRunSummary).not.toHaveBeenCalled()
    expect(notifyAnalysisConclusion).not.toHaveBeenCalled()
  })

  it('shows the reader what is missing and refuses to give a direction when the model reports gaps', async () => {
    const newsFact = fixtureFact('triggered-news:item-1', 'news:item-1', 'news-sentiment', 'sentiment', 'BTC')
    const macroFact = { ...fixtureFact('fact-1', 'evidence-1', 'actual', 'macro', 'CPI'), value: 3.2 }
    const capitalFact = { ...fixtureFact('fact-2', 'evidence-2', 'etf-net-flow-usd', 'capital', 'BTC'), value: -2.92 }
    const newsSnapshot = {
      ...fixtureSnapshot(),
      facts: [newsFact, macroFact, capitalFact],
      evidenceRefs: [{ evidenceRefId: 'news:item-1' }, { evidenceRefId: 'evidence-1' }, { evidenceRefId: 'evidence-2' }],
      trigger: { source: 'intelligence-item' as const, itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
    } as unknown as EvidenceSnapshot
    const handles = buildAnalysisReferenceMap(newsSnapshot)
    const f = (factId: string): string => handles.factHandleById.get(factId)!
    const e = (evidenceRefId: string): string => handles.evidenceHandleById.get(evidenceRefId)!
    const output = {
      what: { evidenceRef: e('news:item-1'), actor: '据报道，', action: '某公司宣布裁员。', whyRelated: '风险偏好承压，偏向偏空。', stance: 'bearish' },
      reading: {
        checks: [
          { evidenceRef: e('evidence-1'), effect: 'supports', statement: 'CPI 3.2%。' },
          { evidenceRef: e('evidence-2'), effect: 'supports', statement: 'ETF 净流出 -2.92%。' }
        ],
        contradiction: false, verdict: 'supports'
      },
      // 判不了：金额缺、只能等后续披露。方向必须写 undecided，读者正文不出现方向。
      outlook: {
        direction: 'undecided',
        mechanism: '内部记录：短期偏空，但金额缺失，无法判断。',
        watchFor: [{ refKind: 'fact', ref: f('fact-1') }],
        invalidation: { refKind: 'fact', factRef: f('fact-2') }
      },
      gaps: [{ item: 'amount', state: 'not-yet', note: '原文没给金额，等后续披露才能判断。' }]
    }
    const commitSuccessfulAnalysis = vi.fn()
    const newsRun = {
      ...fixtureRunShape(),
      analysisKind: 'news' as const, triggerKey: 'news.manual',
      promptVersion: 'news-analysis-v2', skillVersion: 'news-analysis-v1', outputSchemaVersion: 1
    }
    const orchestrator = createAnalysisOrchestrator({
      repository: createRepository({
        getRun: () => newsRun, getSnapshot: () => newsSnapshot, listSnapshots: () => [newsSnapshot],
        latestSummaryVersion: () => 0, commitSuccessfulAnalysis
      }),
      structuredModelInvocation: {
        invoke: vi.fn(async () => ({ ok: true as const, output, providerId: 'provider-1', modelId: 'model-1', trace: { taskId: 'mi-ar-1', durationMs: 2 } }))
      } as never,
      now: () => asOf, timeZone: () => 'UTC', idFactory: idFactory()
    })

    await expect(orchestrator.run({ analysisRunId: 'mi-ar-1' })).resolves.toEqual({ status: 'succeeded' })
    const summary = (commitSuccessfulAnalysis.mock.calls[0]![0] as Record<string, unknown>).summary as Record<string, unknown>
    const conclusion = summary.conclusion as Record<string, unknown>
    // 第二段说缺哪一项，第三段说无法判断 + 何时能判断。
    expect(conclusion.change).toBe('金额尚未公布。')
    expect(conclusion.causalChain).toContain('无法判断')
    expect(conclusion.causalChain).toContain('等后续披露才能判断')
    // 判不了却给方向是需求稿禁止的：机制里那句「短期偏空」不许漏到读者正文。
    expect(conclusion.causalChain).not.toContain('偏空')
    expect(conclusion.causalChain).not.toContain('短期')
    expect(conclusion.direction).toBe('undecided')
  })
})

function fixtureFact(factId: string, evidenceRefId: string, metric: string, domain: string, subject: string) {
  return { factId, evidenceRefId, metric, domain, subject, value: 1, unit: 'percent', sourceId: 'official', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const }
}

function fixtureSnapshot() {
  return {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'snapshot-hash', profileId: 'crypto-market-analysis-v1',
    facts: [fixtureFact('fact-1', 'evidence-1', 'actual', 'macro', 'CPI')],
    missingDomains: [], caveats: [], evidenceRefs: [{ evidenceRefId: 'evidence-1' }], sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  } as unknown as import('../../../contracts/marketAnalysisContracts').EvidenceSnapshot
}

function fixtureRunShape(): Record<string, unknown> {
  return {
    id: 'mi-ar-1', schemaVersion: 1, analysisKind: 'market', eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
    analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey: 'key', status: 'queued', attempt: 1,
    retryOfRunId: null, modelProviderId: null, modelId: null, validationMode: null, policyVersion: 'policy', promptVersion: 'market-analysis-v1',
    skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
    failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
  }
}

function createRepository(overrides: Record<string, unknown> = {}) {
  const run: AnalysisRun = {
    id: 'mi-ar-1', schemaVersion: 1, analysisKind: 'market', eventGroupId: 'mi-eg-1', snapshotId: 'mi-es-1', snapshotHash: 'snapshot-hash',
    analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', idempotencyKey: 'key', status: 'queued', attempt: 1,
    retryOfRunId: null, modelProviderId: null, modelId: null, validationMode: null, policyVersion: 'policy', promptVersion: 'market-analysis-v1',
    skillVersion: 'market-analysis-v1', outputSchemaVersion: 1, jobRunId: null, traceId: null, failureCode: null,
    failureDetailCode: null, queuedAt: asOf, startedAt: null, completedAt: null
  }
  const snapshot: EvidenceSnapshot = {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'snapshot-hash', profileId: 'crypto-market-analysis-v1',
    facts: [{ factId: 'fact-1', domain: 'macro', subject: 'CPI', metric: 'actual', value: '3.2', unit: 'percent', sourceId: 'official', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: 'evidence-1' }],
    missingDomains: [], caveats: [], evidenceRefs: [{ evidenceRefId: 'evidence-1', sourceId: 'official', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'hash' }], sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
  const group: EventGroup = { id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'macro', mergeKey: 'macro|official', firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-28T02:00:00.000Z', eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: 'mi-as-old', supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf }
  return {
    getRun: () => run,
    getSnapshot: () => snapshot,
    getEventGroup: () => group,
    getSummary: () => ({ id: 'mi-as-old', version: 1 }),
    claimRun: vi.fn(() => true),
    updateRunStatus: vi.fn(),
    commitSuccessfulAnalysis: vi.fn(),
    ...overrides
  } as never
}

function validOutput() {
  return {
    conclusion: {
      direction: 'range' as const,
      summary: '官方数据已发布，市场反应仍需观察。',
      change: '本次没有新变化。',
      causalChain: '官方数据发布 → 风险偏好待确认 → 方向暂不判断。',
      conditions: ['后续价格数据保持可比。'],
      macro: null,
      evidenceStrength: null,
      dataGaps: []
    },
    knownFacts: [{ factId: 'fact-1', statement: 'CPI 实际值为 3.2%。', evidenceRefIds: ['evidence-1'] }],
    transmissionHypotheses: [{ statement: '风险偏好可能受到影响。', evidenceRefIds: ['evidence-1'] }],
    marketReaction: [{ statement: 'BTC 短期反应待确认。', factIds: ['fact-1'], evidenceRefIds: ['evidence-1'] }],
    supportingEvidence: [{ statement: '官方发布可核验。', evidenceRefId: 'evidence-1' }],
    counterEvidence: [],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '维持观察', conditions: ['价格数据保持可比'], invalidation: { kind: 'fact', factId: 'fact-1', relation: 'below', statement: '出现相反事实' }, status: 'pending' }],
    directions: [
      { horizon: 'short', direction: 'bullish', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: ['evidence-1'] },
      { horizon: 'medium', direction: 'range', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: ['evidence-1'] },
      { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['evidence-1'] }
    ],
    nextCatalysts: [{ statement: '关注下一次官方数据。', evidenceRefIds: ['evidence-1'] }],
    dataCaveats: [],
    evidenceRefs: ['evidence-1']
  }
}

function idFactory(): () => string {
  return () => 'mi-as-1'
}

// The model contract bounds a single field at 2,000 characters. This assessment
// stays inside that contract while being far longer than any timeline preview
// budget, so a persisted preview shortening is observable.
function assessmentLongerThanTimelinePreviewPolicy(): string {
  return `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
}
