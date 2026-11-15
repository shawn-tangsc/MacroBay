/**
 * `intelligenceModule` 的契约部分：产品 id、启动 bundle 标记、原始记录补跑策略、平台 hooks 类型。
 *
 * 2026-11-15 拆分 M1，**只搬不改**：下面每一段的函数体、注释、常量值都与搬出来之前逐字相同
 * （唯一差异是这里多了这份文件头与 import）。`logMainStartupBundle` 仍在**模块加载时**执行——
 * 它打的是 `__filename`，主进程只有 `out/main/index.js` 一个打包产物，所以搬到这里读到的是同一个文件。
 *
 * 为什么 hooks 类型下沉、`IntelligenceModule` 类型留在组合根：后者三十个字段一半是
 * `ReturnType<typeof createX>`，搬过来会让本文件反向 import 每个工厂，形成 type-only 环。
 */
import { statSync } from 'node:fs'

import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import type { JobRuntime } from '@platform/jobs'
import type { EventBusRuntime } from '@platform/message-bus'
import type { PlatformWebSocketConstructor } from '@platform/network/platformWebSocket'
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import type { CapitalConditionsPlatformFetch } from './capital-conditions/capitalConditionsHttpClient'
import { INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB } from './jobs/intelligenceJobIds'
import type { WebSearchProductHooks } from './webSearchProductHooks'

const PRODUCT_ID = 'market-intelligence'

/**
 * One line at main-process startup naming the bundle that is actually running.
 *
 * The reader and I spent a long stretch comparing a fixed build against a window that had loaded an
 * older one: a renderer reload looks like a restart in the terminal, and the main process quietly
 * keeps the code it started with. Printing the bundle's own modification time (and the start time)
 * makes "which build is live" a fact rather than a deduction.
 */
function logMainStartupBundle(): void {
  try {
    const bundle = statSync(__filename)
    console.log(JSON.stringify({
      marker: 'MI_MAIN_STARTUP', productId: PRODUCT_ID,
      bundleBuiltAt: new Date(bundle.mtimeMs).toISOString(), bundleBytes: bundle.size,
      startedAt: new Date().toISOString(), pid: process.pid
    }))
  } catch {
    // A marker that cannot be read must never stop the product from starting.
  }
}
logMainStartupBundle()

export const intelligenceRawRecordStartupRecoveryPolicy = {
  completionObservationTimeoutMs: 30_000,
  definition() {
    return {
      id: 'market-intelligence.startup-recover-pending-raw-records',
      owner: 'product' as const,
      productId: PRODUCT_ID,
      handlerId: INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
      title: 'Recover pending intelligence raw records',
      trigger: { kind: 'startup' as const },
      payload: {}
    }
  },
  async completeBeforeSourceRuntime(jobRuntime: Pick<JobRuntime, 'enqueueDefinition' | 'waitForRunTerminal'>): Promise<void> {
    try {
      const run = await jobRuntime.enqueueDefinition(this.definition())
      await jobRuntime.waitForRunTerminal(run.id, {
        timeoutMs: this.completionObservationTimeoutMs
      })
    } catch {
      // Source runtime recovery remains available when pending raw recovery cannot start or observe completion.
    }
  }
} as const

export type IntelligenceModulePlatformHooks = WebSearchProductHooks & {
  getProviderState?: () => Promise<ProviderState>; /** 平台落盘日志（app.log）：补跑等后台事实走它，console 只在终端里。 */ log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /** 模型服务页「默认模型」只读投影；翻译偏好跟随其中的默认翻译模型。 */
  getModelDefaults?: () => Promise<ModelDefaultsSettings>
  eventBusRuntime?: EventBusRuntime
  /** Required: the first call must inject it, and every consumer reads this one. */
  platformFetch: CapitalConditionsPlatformFetch
  /** The shell's single time zone reader; a product job's day boundary follows the setting, never the machine. Required: a missing one used to become UTC silently. */
  getTimeZone: () => string
  /** The reader changed their display zone: the brief schedule follows it without a settings save. */
  onSettingsCommitted?: (listener: (change: Readonly<{ changedKeys: readonly string[]; next: Readonly<{ timeZone: string }> }>) => void) => () => void
  /**
   * The platform's proxy-aware socket constructor, injected lazily. It is a thunk rather than a
   * constructor because the desktop shell can only build it once network settings are readable —
   * binding it eagerly would hand the product a constructor that fails on its first connect.
   */
  createPlatformWebSocket?: () => PlatformWebSocketConstructor
  /** Any source switch, so a product-owned job can arm or drop its own schedule. */
  onSourceEnabledChanged?: (sourceId: string) => void | Promise<void>
  /** Reconcile the automatic calendar job registry after a feed switch. */
  onCalendarEnabledChanged?: () => void | Promise<void>
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  /** 自动会话的幂等窄查（按 agentId + originRef）：同一期只复用一条会话。 */
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<AgentSessionEntity | null>
  sendAgentMessage?: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  cancelAgentSession?: (sessionId: string) => Promise<void> | void
  appendAgentSessionMessages?: (input: CreateAgentSessionMessagesDto) => Promise<AgentSessionMessageEntity[]>
  updateAgentSession?: (sessionId: string, patch: UpdateAgentSessionDto) => Promise<AgentSessionEntity>
  deleteAgentSessions?: (sessionIds: string[]) => Promise<unknown>
  updateAgent?: (agentId: string, patch: import('@platform/ai/agent-platform/schemas/agentSchemas').UpdateAgentDto) => Promise<unknown>
  /** 平台通知运行时的提交入口（契约 §3.2）；未注入时来源事件不发通知，采集照常。 */
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 平台「把一条已有记录再推一次手机」的入口（契约 §16.3.4）；只给读者点击的发布按钮用。 */
  redeliverPush?: import('./daily-briefing/dailyBriefingPublishToPhone').BriefingRedeliver
}

/* 对外名字仍从这里出：`bootstrap.ts` / 两个 IPC 模块 / `handlerRegistry` 的 import 路径一个字没变。 */
export { PRODUCT_ID as INTELLIGENCE_PRODUCT_ID }
