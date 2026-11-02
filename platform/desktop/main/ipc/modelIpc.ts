import { session, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'

import { editProviderImages, validateImageEditInput, type ImageEditSourceMime } from '../../../ai/providers/providerImageEdit'
import { generateProviderImages, validateImageGenerationInput } from '../../../ai/providers/providerImageGeneration'
import { createModelProviderDetectionService } from '../modelProviderDetectionService'
import type { ModelDetectionMode } from '../../../ai/providers/modelDetection/types'
import {
  normalizeModelSyncPlan,
  previewProviderModelSync,
  toModelSyncFailure,
  type ModelSyncApplyOutcome
} from '../../../ai/providers/providerModelSync'
import type { ModelDefinition, ModelProviderInput } from '../../../ai/providers/modelProviderTypes'
import { isEndpointProbeKind, probeProviderEndpoint } from '../../../ai/providers/providerEndpointProbe'
import { testModelProviderConnection, probeProviderProxyTarget } from '../../../ai/providers/providerConnection'
import {
  DIRECT_PROBE_ENDPOINTS,
  isLoopbackProxyEndpoint,
  isProxyEndpointReachable,
  parseResolvedProxy,
  probeDirectEgress
} from '../../../network/proxySelfTest'
import { createGeneratedImageStorage } from '../../../storage/generatedImageStorage'
import type { StoredGeneratedImage } from '../../../storage/generatedImageStorage'
import { createAssistantImageMessageService } from '../../../ai/assistant-platform/images/assistantImageMessageService'
import { createInUseModelPatrolRuntime } from '../../../ai/providers/inUseModelPatrolRuntime'
import { createProviderStore } from '../../../ai/providers/providerStore'
import { createAgentRuntimeProbeSnapshotStore } from '../agentModelCompatibility/AgentRuntimeProbeSnapshotStore'
import { createProviderRuntimeCheckService } from '../agentModelCompatibility/ProviderRuntimeCheckService'
import { resolveImageEditSource } from '../providerImageSource'
import { IpcChannels } from '../../ipc/channels'

/** 这些标识符在 app.ts 里是模块级单例；这里只声明用到的形状，减少搬运时的连带改动。 */
export type ModelIpcPorts = Readonly<{
  providerStore: ReturnType<typeof import('../../../ai/providers/providerStore').createProviderStore>
  getPlatformFetch: () => typeof fetch
  getMainWindow: () => BrowserWindow | null
  invalidateModelCompatibilityCache: (providerId?: string) => void
  agentRuntimeProbeSnapshotStore: ReturnType<
    typeof import('../agentModelCompatibility/AgentRuntimeProbeSnapshotStore').createAgentRuntimeProbeSnapshotStore
  >
  syncInUseModelPatrolScheduleFromState: () => void
  inUseModelPatrol: ReturnType<typeof import('../../../ai/providers/inUseModelPatrolRuntime').createInUseModelPatrolRuntime>
  providerRuntimeCheckService: ReturnType<
    typeof import('../agentModelCompatibility/ProviderRuntimeCheckService').createProviderRuntimeCheckService
  >
  assistantImageMessages: ReturnType<typeof createAssistantImageMessageService>
  generatedImageStorage: ReturnType<typeof createGeneratedImageStorage>
}>

export function registerModelIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: ModelIpcPorts
): void {
  const {
    providerStore,
    getPlatformFetch,
    getMainWindow,
    invalidateModelCompatibilityCache: invalidateAgentModelCompatibilityCache,
    agentRuntimeProbeSnapshotStore,
    syncInUseModelPatrolScheduleFromState,
    inUseModelPatrol,
    providerRuntimeCheckService,
    assistantImageMessages,
    generatedImageStorage
  } = ports

ipcMain.handle(IpcChannels.modelProvidersList, () => providerStore.list())
ipcMain.handle(IpcChannels.modelProvidersUpsert, async (_event: IpcMainInvokeEvent, provider: ModelProviderInput) => {
  const result = await providerStore.upsert(provider)
  invalidateAgentModelCompatibilityCache(provider.id)
  // 保存 Key / 改地址后，旧的逐模型运行证据必须作废，否则会出现
  // "同一供应商有的模型说缺少 API Key、有的正常"（旧快照没失效）。
  await agentRuntimeProbeSnapshotStore.invalidateProvider(provider.id).catch(() => undefined)
  syncInUseModelPatrolScheduleFromState()
  return result
})
ipcMain.handle(IpcChannels.modelProvidersRemove, async (_event: IpcMainInvokeEvent, providerId: string) => {
  const result = await providerStore.remove(providerId)
  invalidateAgentModelCompatibilityCache(providerId)
  syncInUseModelPatrolScheduleFromState()
  return result
})
ipcMain.handle(IpcChannels.modelProvidersSetEnabled, (_event: IpcMainInvokeEvent, providerId: string, enabled: boolean) =>
  providerStore.setEnabled(providerId, enabled).then((result) => {
    invalidateAgentModelCompatibilityCache(providerId)
    syncInUseModelPatrolScheduleFromState()
    return result
  })
)
ipcMain.handle(IpcChannels.modelProvidersAddOrUpdateModel, (_event: IpcMainInvokeEvent, providerId: string, model: ModelDefinition) =>
  providerStore.addOrUpdateModel(providerId, model).then((result) => {
    invalidateAgentModelCompatibilityCache(providerId)
    return result
  })
)
ipcMain.handle(IpcChannels.modelProvidersRemoveModel, (_event: IpcMainInvokeEvent, providerId: string, modelId: string) =>
  providerStore.removeModel(providerId, modelId).then((result) => {
    invalidateAgentModelCompatibilityCache(providerId)
    return result
  })
)
ipcMain.handle(IpcChannels.modelProvidersSetDefaultChatModel, (_event: IpcMainInvokeEvent, providerId: string, modelId: string) =>
  providerStore.setDefaultChatModel(providerId, modelId).then((result) => {
    invalidateAgentModelCompatibilityCache(providerId)
    return result
  })
)
ipcMain.handle(
  IpcChannels.modelProvidersTestConnection,
  async (
    _event: IpcMainInvokeEvent,
    providerId: string,
    options?: {
      modelId?: string
      proxyProbeUrl?: string
      /** PLAT-63：单个已保存端点的测试（同一通道、additive 参数；不新增通道）。 */
      endpointTest?: { kind?: unknown; baseUrl?: unknown }
    }
  ) => {
    // PLAT-61 代理自检（同一通道、additive 参数）：无鉴权 GET，用 Electron net.fetch 走当前 session 代理。
    if (typeof options?.proxyProbeUrl === 'string' && options.proxyProbeUrl.trim()) {
      const targetUrl = options.proxyProbeUrl.trim()
      // 证据链三项：网络栈的真实解析结果、代理端点可达性、经代理请求的状态码与耗时。
      // 不看用户输入：用户填了代理不代表这次真的走了代理。
      const resolvedProxy = await session.defaultSession.resolveProxy(targetUrl)
      const route = parseResolvedProxy(resolvedProxy)
      // 对照探针与其它两项并行：它只回答「本机能不能出一个 TCP 连接」，不跟随代理。
      const [endpointReachable, directProbeReachable] = await Promise.all([
        route.endpoint ? isProxyEndpointReachable(route.endpoint) : Promise.resolve(null),
        probeDirectEgress()
      ])
      const probe = await probeProviderProxyTarget(targetUrl, getPlatformFetch())
      return {
        ...probe,
        resolvedProxy,
        proxied: !route.direct,
        endpointReachable,
        proxyEndpoint: route.endpoint ? `${route.endpoint.host}:${route.endpoint.port}` : null,
        proxyEndpointLoopback: route.endpoint ? isLoopbackProxyEndpoint(`${route.endpoint.host}:${route.endpoint.port}`) : null,
        directProbeReachable,
        directProbeEndpoint: DIRECT_PROBE_ENDPOINTS.map((endpoint) => `${endpoint.host}:${endpoint.port}`).join(',')
      }
    }
    // PLAT-63：端点测试只接受已知端点类型 + http(s) 地址；校验先于任何网络请求。
    if (options?.endpointTest !== undefined) {
      const kind = options.endpointTest.kind
      const baseUrl = typeof options.endpointTest.baseUrl === 'string' ? options.endpointTest.baseUrl.trim() : ''
      if (!isEndpointProbeKind(kind)) throw new Error('Unknown endpoint kind for probe.')
      if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Endpoint probe requires an http(s) base URL.')
      const provider = await providerStore.resolveRuntimeProvider(providerId)
      if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
      return probeProviderEndpoint(provider, { kind, baseUrl, fetch: getPlatformFetch() })
    }
    const provider = await providerStore.resolveRuntimeProvider(providerId)
    if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
    // 所有 provider 出站都必须走平台 fetch（Electron net.fetch + session 代理），禁止全局 fetch。
    return testModelProviderConnection(provider, { modelId: options?.modelId, fetch: getPlatformFetch() })
  }
)
/**
 * T1–T3：图像生成 / 图像编辑共用**同一条**通道（`operation: 'edit'` 是 additive 参数，不新增通道）。
 * 全部返回结构化 `{ok:...}`，不再抛裸 IPC 错误；顺序固定为
 * 「校验参数 → 解析 provider → 检查端点 → 原图落盘 → 先落 pending 消息 → 出站 → 用同一 id settle」。
 */
ipcMain.handle(
  IpcChannels.modelProvidersGenerateImage,
  async (_event: IpcMainInvokeEvent, providerId: string, input: unknown) => {
    if (typeof providerId !== 'string' || !providerId.trim()) {
      return { ok: false, reasonCode: 'invalid_request', message: 'providerId is required.' }
    }
    const request = readProviderImageChannelRequest(input)
    if (!request.topicId) {
      return { ok: false, reasonCode: 'missing_topic', message: 'Select a topic before generating an image.' }
    }
    // 先校验（model / prompt 长度 / count 1–4 / size 白名单），再解析 provider 并出站。
    const validated = validateImageGenerationInput(input)
    if (!validated.ok) return validated
    // 编辑额外校验原图（≤4MB、mime 白名单、file 名必须是 hash 形状）。
    const editInput = request.operation === 'edit' ? validateImageEditInput(input) : null
    if (editInput && !editInput.ok) return editInput
    const provider = await providerStore.resolveRuntimeProvider(providerId)
    if (!provider) {
      return { ok: false, reasonCode: 'provider_not_found', message: `Provider "${providerId}" was not found.` }
    }
    const endpoint = request.operation === 'edit'
      ? provider.imageEndpoints?.edit
      : provider.imageEndpoints?.generation
    if (!endpoint?.trim()) {
      return { ok: false, reasonCode: 'missing_endpoint', message: 'The provider has no image endpoint configured.' }
    }
    // 原图：会话图片按 hash 文件名读盘，上传字节先落盘；两条路径都只把引用写进消息。
    let editSource: { mime: ImageEditSourceMime; bytes: Uint8Array } | null = null
    let storedSource: StoredGeneratedImage | null = null
    if (request.operation === 'edit') {
      if (!editInput?.ok) {
        return { ok: false, reasonCode: 'invalid_request', message: 'A source image is required.' }
      }
      const resolved = await resolveImageEditSource(generatedImageStorage, editInput.value.sourceImage)
      if (!resolved.ok) return resolved
      editSource = resolved.source
      storedSource = resolved.stored
    }
    const model = provider.models.find((entry) => entry.id === validated.value.modelId)
    // 生成中：先落 pending 占位（完成时用同一个 id 替换，不会多出一条消息）。
    const prepared = await assistantImageMessages.prepare({
      topicId: request.topicId,
      operation: request.operation,
      modelId: validated.value.modelId,
      modelSnapshot: { id: validated.value.modelId, name: model?.name ?? validated.value.modelId, provider: provider.name },
      prompt: validated.value.prompt,
      ...(storedSource ? { sourceImage: storedSource } : {})
    })
    if (!prepared.ok) return prepared
    // 所有 provider 出站都必须走平台 fetch（Electron net.fetch + session 代理），禁止全局 fetch。
    const outcome = request.operation === 'edit'
      ? await editProviderImages(provider, { ...validated.value, source: editSource!, fetch: getPlatformFetch() })
      : await generateProviderImages(provider, { ...validated.value, fetch: getPlatformFetch() })
    return assistantImageMessages.settle({ assistantMessageId: prepared.assistantMessageId, outcome })
  }
)
// PLAT-82：「检测模型」= 联通性 + 协议支持探测。主进程执行（Key 只在主进程、并发 5、
// abort 记账在 main），结果只存内存、绝不写库；一模型一条 progress 事件，run 结束发 done。
const modelProviderDetection = createModelProviderDetectionService({
  resolveProvider: (providerId: string) => providerStore.resolveRuntimeProvider(providerId),
  fetch: () => getPlatformFetch(),
  onProgress: (result) => {
    getMainWindow()?.webContents.send(IpcChannels.modelProvidersDetectionProgress, result)
  },
  onDone: (runId, payload) => {
    getMainWindow()?.webContents.send(IpcChannels.modelProvidersDetectionDone, runId, payload)
  },
  // PLAT-82：run 结束后把「实测通过」的协议写回模型（一次写入；状态文案不落库）。
  recordProbedProtocols: (providerId, updates) => providerStore.recordProbedProtocols(providerId, updates),
  // 可用性结论：只写 ok / failed；渲染层用同一指纹函数判过期。
  recordModelAvailability: (providerId, updates, checkedAt) =>
    providerStore.recordModelAvailability(providerId, updates, checkedAt)
})
ipcMain.handle(
  IpcChannels.modelProvidersDetectModels,
  async (
    _event: IpcMainInvokeEvent,
    providerId: string,
    options?: { modes?: unknown; runId?: unknown; modelIds?: unknown }
  ) => {
    if (typeof providerId !== 'string' || !providerId.trim()) {
      throw new Error('providerId is required.')
    }
    return modelProviderDetection.detectModels(providerId, {
      modes: (options?.modes ?? []) as ModelDetectionMode[],
      runId: typeof options?.runId === 'string' ? options.runId : '',
      ...(Array.isArray(options?.modelIds) ? { modelIds: options.modelIds as string[] } : {})
    })
  }
)
ipcMain.handle(
  IpcChannels.modelProvidersCancelModelDetection,
  (_event: IpcMainInvokeEvent, runId: string) => {
    if (typeof runId === 'string' && runId.trim()) modelProviderDetection.cancelModelDetection(runId)
  }
)
ipcMain.handle(
  IpcChannels.modelProvidersRunRuntimeChecks,
  async (
    _event: IpcMainInvokeEvent,
    providerId: string,
    options?: { modelId?: string; runtimeId?: 'claude-code' | 'openai-agents'; checkGateway?: boolean }
  ) => {
    const provider = await providerStore.resolveRuntimeProvider(providerId)
    if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
    const modelId =
      options?.modelId?.trim() ||
      provider.defaultChatModelId ||
      provider.models.find((model) => model.capabilities.chat)?.id
    if (!modelId) throw new Error('Add at least one chat-capable model first.')
    return providerRuntimeCheckService.runChecks({
      providerId,
      modelId,
      runtimeId: options?.runtimeId ?? 'claude-code',
      checkGateway: options?.checkGateway
    })
  }
)
ipcMain.handle(
  IpcChannels.modelProvidersGetRuntimeCheckReport,
  async (
    _event: IpcMainInvokeEvent,
    providerId: string,
    modelId: string,
    runtimeId: 'claude-code' | 'openai-agents' = 'claude-code'
  ) => providerRuntimeCheckService.getReport(providerId, modelId, runtimeId)
)
ipcMain.handle(IpcChannels.modelProvidersGetInUseRetired, () => inUseModelPatrol.getRetired())
/**
 * PLAT-61 诊断可用性：模型同步失败**不再 throw**（原始 IPC Error 会带着
 * `Error invoking remote method '<channel>'` 泄漏到 UI）。改为结构化结果：
 * `{ ok:false, reasonCode, message }`；`ok:true` 仍保留既有 `added`/`missing`/provider 字段。
 * 通道名与载荷形状保持向后兼容。
 */
ipcMain.handle(IpcChannels.modelProvidersPreviewModelSync, async (_event: IpcMainInvokeEvent, providerId: string) => {
  const provider = await providerStore.resolveRuntimeProvider(providerId)
  if (!provider) {
    return { ok: false, reasonCode: 'provider_not_found', message: 'The provider was not found.' }
  }
  // 模型同步同样必须走平台 fetch（否则会绕过代理，需代理的域名必然超时）。
  return previewProviderModelSync(provider, { fetch: getPlatformFetch() })
})
ipcMain.handle(IpcChannels.modelProvidersApplyModelSync, async (
  _event: IpcMainInvokeEvent,
  providerId: string,
  plan: unknown
): Promise<ModelSyncApplyOutcome> => {
  try {
    const result = await providerStore.applyModelSync(providerId, normalizeModelSyncPlan(plan))
    invalidateAgentModelCompatibilityCache(providerId)
    return { ok: true, provider: result }
  } catch (error) {
    return toModelSyncFailure(error)
  }
})
/**
 * PLAT-58：产品 owner 决定允许 UI 显式查看已保存的完整 Key。
 * 只读、绝不打印该值；只允许已知 provider，校验失败不触碰 vault。
 */
ipcMain.handle(IpcChannels.modelProvidersSetCustomHeaders, async (_event: IpcMainInvokeEvent, providerId: string, headers: unknown) => {
  if (typeof providerId !== 'string' || !providerId.trim()) return { ok: false, error: 'invalid_provider' }
  if (!Array.isArray(headers)) return { ok: false, error: 'invalid_headers' }
  const provider = await providerStore.setCustomHeaders(providerId, headers)
  return { ok: true, provider }
})

ipcMain.handle(IpcChannels.modelProvidersRevealCustomHeaders, async (_event: IpcMainInvokeEvent, providerId: string) => {
  if (typeof providerId !== 'string' || !providerId.trim()) return { headers: [] }
  const headers = await providerStore.revealCustomHeaders(providerId)
  return { headers }
})

ipcMain.handle(IpcChannels.modelProvidersRevealApiKey, async (_event: IpcMainInvokeEvent, providerId: string) => {
  if (typeof providerId !== 'string' || !providerId.trim()) throw new Error('Provider id is required.')
  const knownProviders = await providerStore.list()
  if (!knownProviders.some((provider) => provider.id === providerId)) {
    throw new Error(`Provider "${providerId}" was not found.`)
  }
  return { apiKey: await providerStore.revealApiKey(providerId) }
})

}

/**
 * T1–T3：图像通道的 additive 参数（`operation` / `topicId` / `sourceImage`）。
 * 只做形状归一，不做业务校验（校验在 providerImageGeneration / providerImageEdit 里）。
 */
function readProviderImageChannelRequest(input: unknown): {
  operation: 'generate' | 'edit'
  topicId: string
} {
  const record = (input ?? {}) as Record<string, unknown>
  return {
    operation: record.operation === 'edit' ? 'edit' : 'generate',
    topicId: typeof record.topicId === 'string' ? record.topicId.trim() : ''
  }
}
