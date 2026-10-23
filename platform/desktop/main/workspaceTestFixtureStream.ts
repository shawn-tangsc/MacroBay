import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../../ai/agent-platform/runtime/agentChatRuntime'
import {
  addPendingAssistantMessageToState,
  buildRuntimeTurnResult,
  createRuntimeTextData,
  patchRuntimeAssistantMessage
} from '../../ai/agent-platform/runtime/agentTurnPersistence'
import type { AgentRuntimeDriver, AgentRuntimeSessionChunk } from '../../ai/agent-platform/runtime/runtimeTypes'
import {
  addAgentSessionMessage,
  type AgentStoreSeed,
  type AgentStoreState
} from '../../ai/agent-platform/store/agentStore'
import {
  WORKSPACE_TEST_FIXTURES_GLOBAL_KEY,
  WORKSPACE_TEST_FIXTURES_KIND,
  WORKSPACE_TEST_FIXTURE_PRODUCT_ID,
  WORKSPACE_TEST_STREAM_AGENT_ID,
  WORKSPACE_TEST_STREAM_SESSION_ID,
  WORKSPACE_TEST_STREAM_WORKSPACE_ID,
  type WorkspaceTestFixtures
} from './workspaceTestFixtures'

/**
 * Owner: platform/desktop/main（PLAT-33 test-only seam 的**流源桩**部分；从 `workspaceTestFixtures` 拆出，
 * 见 AGENTS.md「新源文件通常 <300 行」）。`workspaceTestFixtures.ts` 继续作为**唯一公开入口**再导出这里的三个
 * 导出，因此组合根（`app.ts`）的注入点与导入路径零改动。
 *
 * 语义不变：受控 agent/session 种子 + 实现既有 `AgentRuntimeDriver` 契约的流源桩 + test-only 计数钩子。
 * 本模块**只在函数体内**读取 `workspaceTestFixtures` 的常量（模块求值期零读取）⇒ 与入口模块的循环导入无害。
 */

/**
 * 受控 agent/session/workspace 种子。agent `type` 必须落在既有 `AgentType` 联合（= `claude-code`）上，
 * 因为流源桩是**替换既有 claude-code 驱动注册**（与 `createTaskAutomationSmokeDriver` 同一注册点），
 * 而不是新增一个 AgentType（那会牵动 schema、UI 与产品侧校验）。
 */
export function createWorkspaceTestFixtureAgentSeed(createdAt: string): AgentStoreSeed {
  const workspace = {
    id: WORKSPACE_TEST_STREAM_WORKSPACE_ID,
    name: 'PLAT-33 controlled stream workspace (test-only)',
    path: '/tmp/plat33-test-fixture-workspace',
    type: 'system' as const,
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt
  }
  return {
    agents: [{
      id: WORKSPACE_TEST_STREAM_AGENT_ID,
      type: 'claude-code',
      name: 'PLAT-33 controlled stream agent (test-only)',
      model: null,
      modelName: null,
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt,
      configuration: { permission_mode: 'bypassPermissions' }
    }],
    workspaces: [workspace],
    sessions: [{
      id: WORKSPACE_TEST_STREAM_SESSION_ID,
      agentId: WORKSPACE_TEST_STREAM_AGENT_ID,
      name: 'PLAT-33 controlled stream session (test-only)',
      workspaceId: workspace.id,
      workspace,
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }],
    activeAgentId: WORKSPACE_TEST_STREAM_AGENT_ID,
    activeSessionId: WORKSPACE_TEST_STREAM_SESSION_ID
  }
}

export type WorkspaceTestStreamStats = {
  sendCount: () => number
  emittedChunkCount: () => number
}

/**
 * 受控流源桩（既有 `AgentRuntimeDriver` 契约）：逐块 emit 累计文本，块间 `chunkIntervalMs` 延迟
 * ⇒ detach/redock 发生在**流仍 in-flight** 时；终态把 assistant 消息推进到 `success` 并落库。
 * 计数（send/emit）只暴露给 seam 自己安装的 test-only 钩子，产品代码零依赖。
 */
export function createWorkspaceTestStreamDriver(deps: {
  getState: () => Promise<AgentStoreState>
  saveState: (state: AgentStoreState, sessionId: string) => Promise<void>
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
  chunkCount: number
  chunkIntervalMs: number
  finalText: string
  delay?: (ms: number) => Promise<void>
}): { driver: AgentRuntimeDriver; stats: WorkspaceTestStreamStats } {
  let sendCount = 0
  let emittedChunkCount = 0
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))

  const driver: AgentRuntimeDriver = {
    async sendMessage(request: AgentChatRuntimeRequest): Promise<AgentChatRuntimeResult> {
      sendCount += 1
      const turnId = request.runId ?? `dsh-fixture-turn-${sendCount}`
      const assistantMessageId = `dsh-fixture-assistant-${turnId}`
      let state = await deps.getState()
      state = addAgentSessionMessage(state, request.sessionId, {
        id: `dsh-fixture-user-${turnId}`,
        role: 'user',
        status: 'success',
        data: createRuntimeTextData(request.text)
      })
      state = addPendingAssistantMessageToState(state, {
        sessionId: request.sessionId, assistantMessageId, modelId: null, modelName: null
      })
      await deps.saveState(state, request.sessionId)

      let accumulated = ''
      for (let index = 1; index <= deps.chunkCount; index += 1) {
        const delta = `chunk-${index}`
        accumulated = `${accumulated}${delta}`
        deps.emitChunk({
          type: 'assistant-text-update',
          sessionId: request.sessionId,
          runId: turnId,
          text: accumulated,
          textDelta: delta,
          mode: 'append'
        })
        emittedChunkCount += 1
        await delay(deps.chunkIntervalMs)
      }

      state = await patchRuntimeAssistantMessage(
        {
          getAgentState: deps.getState,
          saveAgentState: async (next, options) => {
            await deps.saveState(next, options?.mergeSessionId ?? request.sessionId)
          }
        },
        request.sessionId,
        assistantMessageId,
        { status: 'success', data: createRuntimeTextData(deps.finalText) }
      )
      return buildRuntimeTurnResult(state, request.sessionId, assistantMessageId)
    },
    cancelMessage: () => false,
    cancelSession: () => false
  }

  return {
    driver,
    stats: Object.freeze({
      sendCount: () => sendCount,
      emittedChunkCount: () => emittedChunkCount
    })
  }
}

/**
 * 装 test-only 钩子（`globalThis.__DSH_WORKSPACE_TEST_FIXTURES__`），供真机 harness 在**同一主进程**里读
 * 「send 恰一次」等计数。disabled 时**什么都不装**（生产零影响）。
 */
export function installWorkspaceTestFixtureHandle(input: {
  target: Record<string, unknown>
  fixtures: WorkspaceTestFixtures
  streamStub: WorkspaceTestStreamStats | null
}): void {
  if (!input.fixtures.enabled) return
  input.target[WORKSPACE_TEST_FIXTURES_GLOBAL_KEY] = Object.freeze({
    testOnly: true,
    kind: WORKSPACE_TEST_FIXTURES_KIND,
    path: input.fixtures.path,
    productId: WORKSPACE_TEST_FIXTURE_PRODUCT_ID,
    streamStub: input.streamStub === null ? null : Object.freeze({
      sendCount: input.streamStub.sendCount,
      emittedChunkCount: input.streamStub.emittedChunkCount
    })
  })
}
