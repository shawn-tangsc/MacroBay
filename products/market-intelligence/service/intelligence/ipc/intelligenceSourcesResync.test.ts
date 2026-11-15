import { describe, expect, it, vi } from 'vitest'

import type { IntelligenceModule } from '../intelligenceModule'
import { registerIntelligenceSourcesIpc } from './registerIntelligenceSourcesIpc'

/**
 * **保存开关后必须立刻对账调度**（2026-11-16，Chief 拍板）。
 *
 * 不接这条：读者在设置里打开三路日历，作业要到下次重启才注册，而他不会知道要重启——
 * 表现就是「开关打开了、什么都没有」。判据两条：写档成功 → 对账跑过；对账抛错 → 保存照常成功。
 */
function registrar() {
  const handlers = new Map<string, (payload?: unknown) => Promise<unknown>>()
  return {
    handlers,
    register: (_productId: string, channel: string, handler: (payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    }
  }
}

function fakeModule(result: unknown) {
  const saved = vi.fn(async () => result)
  return {
    saved,
    module: {
      sourcesService: {
        saveProfile: saved,
        setEnabled: saved,
        setCalendarEnabled: saved
      }
    } as unknown as IntelligenceModule
  }
}

describe('intelligenceSources 保存后对账', () => {
  it('三个写档入口都会触发对账（不是只有 saveProfile）', async () => {
    for (const channel of [
      'intelligenceSources.saveProfile',
      'intelligenceSources.setEnabled',
      'intelligenceSources.setCalendarEnabled'
    ]) {
      const { handlers, register } = registrar()
      const { module } = fakeModule({ state: 'saved' })
      const onProfilesChanged = vi.fn(async () => undefined)
      registerIntelligenceSourcesIpc(register as never, {} as never, module, { onProfilesChanged })
      await handlers.get(channel)!({})
      expect(onProfilesChanged, channel).toHaveBeenCalledTimes(1)
    }
  })

  it('对账抛错不影响保存：结果照常返回，只留一行 warn', async () => {
    const { handlers, register } = registrar()
    const { module } = fakeModule({ state: 'saved' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      registerIntelligenceSourcesIpc(register as never, {} as never, module, {
        onProfilesChanged: async () => { throw new Error('scheduler down') }
      })
      await expect(handlers.get('intelligenceSources.setCalendarEnabled')!({})).resolves.toEqual({ state: 'saved' })
      expect(warn.mock.calls.some(([line]) => String(line).includes('对账调度失败'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})