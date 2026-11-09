// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { DailyBriefingFailurePanel } from './DailyBriefingFailurePanel'
import type { DailyBriefingText } from './dailyBriefingText'
import { productText } from '../../shared/i18n/productText'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'

const base = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const trace: GenerationTrace = {
  attemptId: 'attempt-1', startedAt: '2026-11-06T10:11:23.763Z', finishedAt: '2026-11-06T10:13:23.899Z',
  state: 'failed',
  stages: [
    { id: 'source', state: 'success', startedAt: '2026-11-06T10:11:24.000Z', finishedAt: '2026-11-06T10:11:25.000Z', durationMs: 1_000 },
    { id: 'writing', state: 'failed', startedAt: '2026-11-06T10:12:00.000Z', finishedAt: '2026-11-06T10:13:23.000Z', durationMs: 83_000 }
  ]
} as GenerationTrace

async function render(text: DailyBriefingText, failure: Parameters<typeof DailyBriefingFailurePanel>[0]['failure']): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<DailyBriefingFailurePanel failure={failure} text={text} formatTime={(value) => value}
    onOpenSettings={vi.fn()} />))
  return host
}

describe('the failure panel says what happened in a sentence', () => {
  it('names the step that stopped, what happened and how long it took, with no internal code', async () => {
    // 用户 2026-11-06：只写「AI 编辑超时」看不出是写稿那一步卡了两分钟。表里有了这句就照表拼。
    const host = await render(base, { kind: 'editorial', code: 'editorial-timeout', generationTrace: trace })

    // 步骤名用**步骤清单里那一步的真名**（写作），不是表里的兜底名：两处必须同名，否则句子说
    // 写稿、清单写着写作，读者又要猜。
    expect(host.querySelector('[data-failure-reason]')?.textContent)
      .toBe('写作没跑完：等到超时也没返回，这次没写完')
    expect(host.querySelector('[data-failure-next]')?.textContent).toBe('接下来：再试一次；反复出现就换一个模型或检查网络')
    expect(host.textContent).not.toContain('editorial-timeout')
    // 原来的码标签那句不再重复一遍：一句人话已经说了同一件事。
    expect(host.querySelector('[data-failure-code-label]')).toBeNull()
  })

  it('uses the closed table for a real code, and the fallback sentence for one it does not carry', async () => {
    // 表里的码：照表拼。
    const known = await render(base, { kind: 'editorial', code: 'editorial-timeout', generationTrace: trace })
    expect(known.querySelector('[data-failure-reason]')?.textContent)
      .toBe('写作没跑完：等到超时也没返回，这次没写完')

    // 表外码：走兜底句，绝不把码印给读者。
    const unknown = await render(base, { kind: 'generation', code: 'brand-new-reason' })
    expect(unknown.querySelector('[data-failure-reason]')?.textContent).toBe('这次在生成就停下了：这一期没能生成出来')
    expect(unknown.textContent).not.toContain('brand-new-reason')
  })

  it('says the app was closed when the writing runtime was stopped, and never calls it a timeout', async () => {
    // 2026-11-07 20:00 真机：应用在写作中途被关，写作 15.4 秒后运行时释放。旧码把它记成
    // 「超时（用了 1 毫秒）」，读者会去查网络和模型。新码是 `run-interrupted`。
    const stopped: GenerationTrace = {
      attemptId: 'attempt-2', startedAt: '2026-11-07T12:00:02.956Z', finishedAt: '2026-11-07T12:01:39.436Z',
      state: 'failed',
      stages: [
        { id: 'writing', state: 'failed', startedAt: '2026-11-07T12:01:24.079Z', finishedAt: '2026-11-07T12:01:39.435Z', durationMs: 15_356 }
      ]
    } as GenerationTrace
    const host = await render(base, { kind: 'editorial', code: 'run-interrupted', generationTrace: stopped })

    const reason = host.querySelector('[data-failure-reason]')?.textContent ?? ''
    expect(reason).toContain('应用在这之前被关闭了，这次没写完')
    expect(reason).not.toContain('超时')
    expect(host.textContent).not.toContain('1 毫秒')
  })

  it('does not report a duration for the step that failed in a millisecond', async () => {
    // 校验 1 毫秒就判死：说明卡住的不是它。把 1 毫秒写成时长，就是那句自相矛盾的
    // 「超时（用了 1 毫秒）」的来源。
    const instant: GenerationTrace = {
      attemptId: 'attempt-3', startedAt: '2026-11-07T12:00:02.956Z', finishedAt: '2026-11-07T12:01:39.436Z',
      state: 'failed',
      stages: [
        { id: 'writing', state: 'success', startedAt: '2026-11-07T12:01:24.079Z', finishedAt: '2026-11-07T12:01:39.435Z', durationMs: 15_356 },
        { id: 'validation', state: 'failed', startedAt: '2026-11-07T12:01:39.435Z', finishedAt: '2026-11-07T12:01:39.436Z', durationMs: 1 }
      ]
    } as GenerationTrace
    const host = await render(base, { kind: 'editorial', code: 'invalid-json', generationTrace: instant })

    const reason = host.querySelector('[data-failure-reason]')?.textContent ?? ''
    expect(reason).toContain('返回的不是一段能读的 JSON')
    expect(reason).not.toContain('用了')
    expect(reason).not.toContain('1 毫秒')
  })
})

describe('a conclusion validation failure names the missing item, never the internal field', () => {
  it('lists the missing fields in reader words', async () => {
    const host = await render(base, { kind: 'editorial', code: 'invalid-conclusion-synthesis', detail: 'missing: outlook, counterEvidence' })
    expect(host.querySelector('[data-failure-reason]')?.textContent).toContain('结论综述的字段不全或写法不合规')
    expect(host.querySelector('[data-failure-detail]')?.textContent).toBe('详情：缺：未来判断、反证条件')
    expect(host.querySelector('[data-failure-next]')?.textContent).toBe('接下来：重新生成一次；反复出现就换一个模型')
    expect(host.textContent).not.toContain('outlook')
    expect(host.textContent).not.toContain('counterEvidence')
    expect(host.textContent).not.toContain('invalid-conclusion-synthesis')
  })

  it('drops an English field diagnostic instead of printing it', async () => {
    const host = await render(base, { kind: 'editorial', code: 'missing-outlook', detail: 'outlook: state the next-1-3-day bias explicitly' })
    expect(host.querySelector('[data-failure-reason]')?.textContent).toContain('结论缺未来一到三天的方向判断')
    expect(host.querySelector('[data-failure-detail]')).toBeNull()
    expect(host.textContent).not.toContain('outlook:')
  })

  it('names the field a repeated direction came from', async () => {
    const host = await render(base, { kind: 'editorial', code: 'repeated-direction', detail: 'summary' })
    expect(host.querySelector('[data-failure-detail]')?.textContent).toBe('详情：问题在：摘要')
  })
})

describe('the conclusion failure table cannot fall back for a code it should carry', () => {
  const conclusionCodes = [
    'invalid-conclusion-synthesis', 'missing-conclusion-synthesis', 'copied-conclusion',
    'missing-conclusion-evidence', 'missing-conclusion-divergence', 'missing-mechanism',
    'data-only-summary', 'missing-outlook', 'repeated-direction', 'duplicate-statement',
    'invalid-number-format', 'asset-equality-claim', 'missing-hidden-reason',
    'missing-macro-why', 'invalid-macro-why'
  ]
  const fields = [
    'direction', 'confidence', 'summary', 'outlook', 'conditions', 'counterEvidence', 'watch',
    'regimeChange', 'confirmed', 'refuted', 'coreTension', 'whatWouldChange', 'evidenceRefs'
  ]
  it('carries a sentence in both locales for every conclusion validation code', () => {
    const en = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
    for (const code of conclusionCodes) {
      expect(base.failureSentences[code as keyof typeof base.failureSentences], code).toBeDefined()
      expect(en.failureSentences[code as keyof typeof en.failureSentences], code).toBeDefined()
    }
  })
  it('labels every field the synthesis contract can report as missing, in both locales', () => {
    const en = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
    expect(Object.keys(base.failurePanel.conclusionDetail.fields)).toEqual(fields)
    expect(Object.keys(en.failurePanel.conclusionDetail.fields)).toEqual(fields)
  })
})
