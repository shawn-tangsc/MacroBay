import { createJobRuntime } from '@platform/jobs'
import { describe, expect, it, vi } from 'vitest'

import { createIntelligencePipeline } from './intelligencePipeline'
import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createInMemoryIntelligenceCredentialStorage, createIntelligenceCredentialStore } from '../store/intelligenceCredentialStore'

/**
 * 日历开关变化 → 装配层拿到一次「重排期」回调（2026-11-16）。
 *
 * 这条回调在 `bootstrap` 里过去是「一个从未赋值的变量 + narwhal 的 syncSchedule」——死代码已删，
 * 所以这里钉住**实际还会发生什么**：开关一改，回调被等一次；不是日历源就不触发。
 * 删除那个死变量前后，行为就是这两条。
 */
function createService(onCalendarEnabledChanged?: () => Promise<void>) {
  const profileStore = createSourceProfileStore(createInMemoryProfileStorage([]))
  return createIntelligenceSourcesService({
    profileStore,
    pipeline: createIntelligencePipeline({ profileStore }),
    jobRuntime: createJobRuntime(),
    credentialStore: createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage()),
    validateCredential: async () => ({ ok: true, message: 'ok' }),
    ...(onCalendarEnabledChanged === undefined ? {} : { onCalendarEnabledChanged })
  })
}

describe('日历开关变化后的重排期回调', () => {
  it('改了一路日历开关 → 回调被等一次（重排期就发生在它里面）', async () => {
    const hook = vi.fn(async () => undefined)
    const service = createService(hook)
    await expect(service.setCalendarEnabled({ sourceId: 'macro-calendar-0xrouter-economic-data', enabled: false }))
      .resolves.toEqual({ ok: true })
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('不是日历源就不触发（这条回调只管日历排期）', async () => {
    const hook = vi.fn(async () => undefined)
    const service = createService(hook)
    await expect(service.setCalendarEnabled({ sourceId: 'federal-reserve-rss', enabled: false }))
      .resolves.toEqual({ ok: false, failureCode: 'source-not-calendar' })
    expect(hook).not.toHaveBeenCalled()
  })
})