import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIntelligenceStartup } from './intelligenceModuleStartup'

/**
 * M6 抽出来的这一段自己的用例（2026-11-15 拆分 `intelligenceModule.ts`）。
 *
 * 这一段是**顺序契约**，不是普通装配，所以判据只能是「调用序列 + 失败不阻塞」：
 * 默认源迁移 → 维护备用关回去 → 历史会话归位 → 原始记录补跑 → `initializeRuntime` → `startRecovery`。
 * 三段（补跑 / 初始化 / 恢复）原文件里是**并联的 `.finally`**，谁失败都不许挡住后面两段——
 * 写成 `await` 串行会让补跑超时（30s）挡住采集，而这种退化**不会报错**，只会让启动变慢、采集变晚。
 *
 * 第二件：`briefingSessionLinks` 必须**惰性读**。会话链接存储在日报那一段（晚于本段）构造，
 * 这里要是提前取值，老安装的会话身份就归不了位。
 */
const directories: string[] = []

afterEach(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
  directories.length = 0
})

describe('intelligenceModule 启动链', () => {
  function harness(input: { failInitialize?: boolean; failRecovery?: boolean } = {}) {
    const order: string[] = []
    const profileStore = {
      listProfiles: async () => { order.push('migrate'); return [] }
    } as never
    const sourcesService = {
      initializeRuntime: async () => {
        order.push('initializeRuntime')
        if (input.failInitialize === true) throw new Error('runtime boom')
      }
    } as never
    const marketAnalysisRuntime = {
      startRecovery: async () => {
        order.push('startRecovery')
        if (input.failRecovery === true) throw new Error('recovery boom')
      }
    } as never
    const jobRuntime = {
      enqueueDefinition: async () => { order.push('enqueueRecovery'); return { id: 'run-1' } },
      waitForRunTerminal: async () => ({ state: 'terminal' })
    } as never
    let linksRead = 0
    const briefingSessionLinks = () => {
      linksRead += 1
      order.push('readSessionLinks')
      return { listBefore: async () => [] } as never
    }
    /* 独立的 dataDir：迁移标记写到里面，避免跨次运行/跨用例互相影响（标记在就不可能再跑迁移）。 */
    const dataDir = mkdtempSync(join(tmpdir(), 'mi-startup-'))
    directories.push(dataDir)
    const hooks = {
      findAgentSessionByAutomationRef: async () => null,
      updateAgentSession: async () => ({}),
      log: vi.fn()
    } as never
    const created = createIntelligenceStartup({
      jobRuntime, dataDir, profileStore, sourcesService,
      marketAnalysisRuntime, briefingSessionLinks, hooks
    })
    return { created, order, linksRead: () => linksRead }
  }

  it('按顺序跑完，且三段并联：初始化失败不挡恢复，恢复失败也不让 startupReady 拒绝', async () => {
    const { created, order } = harness({ failInitialize: true, failRecovery: true })
    await expect(created.startupReady).resolves.toBeUndefined()
    /* 顺序：迁移（第一条开、第二条关回去，所以读两次 profile）→ 会话归位 → 补跑 →
       initializeRuntime → startRecovery。后三段是并联的 `.finally`，失败不能截断后面两段。 */
    const collapsed = order.filter((step, index) => order[index - 1] !== step)
    expect(collapsed).toEqual(['migrate', 'readSessionLinks', 'enqueueRecovery', 'initializeRuntime', 'startRecovery'])
    // 迁移是**两步且顺序不能反**：先把免钥匙的打开，再把维护备用那批关回去。
    expect(order.filter((step) => step === 'migrate')).toHaveLength(2)
  })

  it('会话链接是惰性读：工厂返回时还没取，链跑到那一步才取，且只取一次', async () => {
    const { created, linksRead } = harness()
    // 关键：构造那一刻不能读（链接存储此时还没建出来）。
    expect(linksRead()).toBe(0)
    await created.startupReady
    expect(linksRead()).toBe(1)
  })
})
