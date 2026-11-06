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
  await act(async () => root.render(<DailyBriefingFailurePanel failure={failure} text={text} formatTime={(value) => value} regenerating={false}
    onRetry={vi.fn()} onOpenSettings={vi.fn()} />))
  return host
}

describe('the failure panel says what happened in a sentence', () => {
  it('names the step that stopped, what happened and how long it took, with no internal code', async () => {
    // 用户 2026-11-06：只写「AI 编辑超时」看不出是写稿那一步卡了两分钟。表里有了这句就照表拼。
    const text: DailyBriefingText = {
      ...base,
      failureSentences: { 'editorial-timeout': { step: '写稿', what: '还没等到返回，这次没写完', next: '重试一次，或换一个响应更快的模型' } }
    }
    const host = await render(text, { kind: 'editorial', code: 'editorial-timeout', generationTrace: trace })

    // 步骤名用**步骤清单里那一步的真名**（写作），不是表里的兜底名：两处必须同名，否则句子说
    // 写稿、清单写着写作，读者又要猜。
    expect(host.querySelector('[data-failure-reason]')?.textContent)
      .toBe('写作没跑完：还没等到返回，这次没写完（用了 1 分 23 秒）')
    expect(host.querySelector('[data-failure-next]')?.textContent).toBe('接下来：重试一次，或换一个响应更快的模型')
    expect(host.textContent).not.toContain('editorial-timeout')
    // 原来的码标签那句不再重复一遍：一句人话已经说了同一件事。
    expect(host.querySelector('[data-failure-code-label]')).toBeNull()
  })

  it('falls back to the readable code label while the table has no sentence for the code', async () => {
    const host = await render(base, { kind: 'editorial', code: 'editorial-timeout', generationTrace: trace })
    expect(host.querySelector('[data-failure-code-label]')?.textContent).toContain(base.aiSettings.failure['editorial-timeout'])
    expect(host.querySelector('[data-failure-reason]')).toBeNull()
  })
})
