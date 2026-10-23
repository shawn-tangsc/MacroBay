import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, vi } from 'vitest'

import { createSystemProviderPresets } from '@platform/ai/providers/providerPresets'
import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings, type AppLanguage, type AppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../../i18n/platformText'
import { AppShell } from '../AppShell'
import { resetModelDetectionControllerForTests } from './modelDetectionController'

/**
 * PLAT-61 测试夹具：真实 AppShell + 真实 modelProviders 桥（只 mock 边界 IPC，不 mock 生产逻辑）。
 * 与 `ModelServiceProviderPage.test.tsx` / `ModelServiceProviderAutosave.test.tsx` 共用。
 */
export const pageLabels = platformText['en-US'].models
export const pageStatusText = platformText['en-US'].status
export const apiKeyFixture = 'fixture-provider-key-1234567890'

const siliconPreset = createSystemProviderPresets().find((preset) => preset.id === 'silicon') ?? ({} as never)

/** 用真实 siliconflow 预设做 fixture：链接、端点、模型分组都来自生产数据。 */
export const providerFixture: SafeModelProvider = {
  ...(siliconPreset as SafeModelProvider),
  id: 'silicon',
  name: 'Silicon',
  enabled: true,
  hasApiKey: true,
  apiKeyPreview: 'sk-s**********7890'
}

export type PlatformApiMock = {
  list: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  setEnabled: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  removeModel: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  revealApiKey: ReturnType<typeof vi.fn>
  previewModelSync: ReturnType<typeof vi.fn>
  /** PLAT-72：一键清空模型的提交入口（复用 applyModelSync 通道）。 */
  applyModelSync: ReturnType<typeof vi.fn>
  testConnection: ReturnType<typeof vi.fn>
  /** PLAT-82：检测走 `detectModels` + progress/done 事件（结果只在内存）。 */
  detectModels: ReturnType<typeof vi.fn>
  cancelModelDetection: ReturnType<typeof vi.fn>
  /** 测试手动推送一条检测结果（默认 `detectModels` 会自动推）。 */
  emitModelDetectionProgress: (result: unknown) => void
  emitModelDetectionDone: (runId: string, payload?: { stopped: boolean }) => void
  addOrUpdateModel: ReturnType<typeof vi.fn>
  updateSettings: ReturnType<typeof vi.fn>
}

/** PLAT-82：一个模型的检测结果 fixture（默认全绿）。 */
export type DetectionResultFixture = {
  status?: 'ok' | 'failed' | 'skipped' | 'cancelled'
  reasonCode?: string
  skipReason?: 'non_text_generation' | 'provider_disabled' | 'not_chat_model' | 'protocol_not_configured'
  protocols?: Array<{ protocol: string; ok: boolean; reasonCode?: string; reused?: boolean }>
  declaredProtocolFailures?: string[]
}

export function installPlatform(options: {
  setEnabledError?: Error
  /** 覆盖预览同步的返回值/抛错，用于诊断可用性用例。 */
  previewModelSync?: () => Promise<unknown>
  /** PLAT-72：清空模型的提交结果（默认成功；抛错用于验证行内失败）。 */
  applyModelSync?: (providerId: string, plan: unknown) => Promise<unknown>
  /** PLAT-63：行内端点探测复用同一通道的 `endpointTest` 参数（需要断言入参）。 */
  testConnection?: (providerId: string, options?: unknown) => Promise<unknown>
  /**
   * PLAT-82：每个模型的检测结果（默认 `ok`）。返回 `'pending'` 表示测试自己用
   * `emitModelDetectionProgress` / `emitModelDetectionDone` 驱动这一条。
   */
  detectionResult?: (providerId: string, modelId: string, modes: readonly string[]) => DetectionResultFixture | 'pending'
  /** 整体替换 `detectModels`（需要自己发 progress/done 时用）。 */
  detectModels?: (providerId: string, request: { modes: string[]; runId: string }) => Promise<{ accepted: boolean; total: number }>
  removeModel?: (providerId: string, modelId: string) => Promise<unknown>
  remove?: (providerId: string) => Promise<unknown>
  settings?: Partial<AppSettings>
  /** 显式指定界面语言（默认 en-US）；`settings.language` 不参与，避免整包默认值把语言带回 zh-CN。 */
  language?: AppLanguage
  provider?: Partial<SafeModelProvider>
  /** 多供应商场景（切供应商回归用）：给了就整体替换默认 fixture。 */
  providers?: SafeModelProvider[]
} = {}): PlatformApiMock {
  let activeProviders: SafeModelProvider[] = options.providers
    ? options.providers.map((provider) => ({ ...provider }))
    : [{ ...providerFixture, ...options.provider }]
  const list = vi.fn(async () => activeProviders)
  const upsert = vi.fn(async (_provider: ModelProviderInput) => activeProviders[0])
  const setEnabled = vi.fn(async (_providerId: string, _enabled: boolean) => {
    if (options.setEnabledError) throw options.setEnabledError
    return undefined
  })
  const remove = vi.fn(async (providerId: string) => {
    if (options.remove) await options.remove(providerId)
    activeProviders = activeProviders.filter((provider) => provider.id !== providerId)
  })
  const removeModel = vi.fn(options.removeModel ?? (async (_providerId: string, _modelId: string) => undefined))
  const openExternal = vi.fn(async (_url: string) => undefined)
  const revealApiKey = vi.fn(async (_providerId: string) => ({ apiKey: apiKeyFixture }))
  const previewModelSync = vi.fn(options.previewModelSync ?? (async () => ({ added: [], missing: [], remoteIds: [] })))
  const applyModelSync = vi.fn(options.applyModelSync ?? (async () => ({ ok: true })))
  // settings.update 的 spy 句柄（在 Object.defineProperty 之前建好，返回给测试断言）。
  const updateSettings = vi.fn(async (patch: unknown) => ({
    ...createDefaultAppSettings(),
    ...options.settings,
    ...(patch as object)
  }))
  // PLAT-82：内存里的检测结果跨用例会残留（模块级单例）⇒ 每个夹具先清空。
  resetModelDetectionControllerForTests()
  const progressListeners = new Set<(result: unknown) => void>()
  const doneListeners = new Set<(runId: string, payload: { stopped: boolean }) => void>()
  const emitModelDetectionProgress = (result: unknown): void => {
    for (const listener of progressListeners) listener(result)
  }
  const emitModelDetectionDone = (runId: string, payload: { stopped: boolean } = { stopped: false }): void => {
    for (const listener of doneListeners) listener(runId, payload)
  }
  /**
   * PLAT-82：检测走 `detectModels` + progress/done 事件（一模型一条完整 result）。
   * 默认对每个模型推一条全绿结果；需要精确控制时用 `detectionResult` 返回 `'pending'`。
   */
  const detectModels = vi.fn(options.detectModels ?? (async (
    providerId: string,
    request: { modes: string[]; runId: string }
  ) => {
    const provider = activeProviders.find((entry) => entry.id === providerId)
    const models = provider?.models ?? []
    void (async () => {
      // 等 `detectModels` 的 accepted 回到渲染层再推结果（真实 IPC 也是先 accepted 后 progress）。
      await new Promise((resolve) => setTimeout(resolve, 0))
      for (const model of models) {
        const fixture = options.detectionResult?.(providerId, model.id, request.modes) ?? {}
        if (fixture === 'pending') continue
        const status = fixture.status ?? 'ok'
        const skipReason = fixture.skipReason
        emitModelDetectionProgress({
          runId: request.runId,
          modelId: model.id,
          status,
          ...(fixture.reasonCode === undefined ? {} : { reasonCode: fixture.reasonCode }),
          ...(status === 'skipped' && skipReason !== undefined
            ? { connectivity: { status: 'skipped', reasonCode: skipReason } }
            : {}),
          ...(fixture.protocols === undefined ? {} : { protocols: fixture.protocols }),
          ...(fixture.declaredProtocolFailures === undefined
            ? {}
            : { declaredProtocolFailures: fixture.declaredProtocolFailures })
        })
      }
      emitModelDetectionDone(request.runId, { stopped: false })
    })()
    return { accepted: true, total: models.length }
  }))
  const cancelModelDetection = vi.fn(async () => undefined)
  const addOrUpdateModel = vi.fn(async () => undefined)
  const testConnection = vi.fn(options.testConnection ?? (async () => ({
    ok: true,
    status: 200,
    durationMs: 1200,
    reasonCode: null,
    targetHost: 'aihubmix.com'
  })))
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => []),
        openExternal
      },
      settings: {
        get: vi.fn(async () => ({
          ...createDefaultAppSettings(),
          ...options.settings,
          language: options.language ?? 'en-US',
          themeMode: 'dark'
        })),
        // PLAT-80：「默认模型」选择器即时保存走既有 settings.update。
        update: updateSettings
      },
      modelProviders: {
        list,
        upsert,
        setEnabled,
        remove,
        addOrUpdateModel,
        removeModel,
        setDefaultChatModel: vi.fn(async () => undefined),
        previewModelSync,
        testConnection,
        applyModelSync,
        detectModels,
        cancelModelDetection,
        onModelDetectionProgress: vi.fn((listener: (result: unknown) => void) => {
          progressListeners.add(listener)
          return () => progressListeners.delete(listener)
        }),
        onModelDetectionDone: vi.fn((listener: (runId: string, payload: { stopped: boolean }) => void) => {
          doneListeners.add(listener)
          return () => doneListeners.delete(listener)
        }),
        revealApiKey,
        setCustomHeaders: vi.fn(async () => activeProviders[0]),
        revealCustomHeaders: vi.fn(async () => [])
      },
      assistants: {
        list: vi.fn(async () => []),
        listTopics: vi.fn(async () => ({ topics: [] })),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
        onStreamChunk: vi.fn(() => () => undefined),
        onStreamDone: vi.fn(() => () => undefined),
        onStreamError: vi.fn(() => () => undefined),
        onStreamStatusChanged: vi.fn(() => () => undefined)
      }
    } as unknown as Window['platform']
  })
  return {
    list,
    upsert,
    setEnabled,
    remove,
    removeModel,
    openExternal,
    revealApiKey,
    previewModelSync,
    applyModelSync,
    testConnection,
    detectModels,
    cancelModelDetection,
    emitModelDetectionProgress,
    emitModelDetectionDone,
    addOrUpdateModel,
    updateSettings
  }
}

export async function renderModelServiceSettings(options: {
  setEnabledError?: Error
  previewModelSync?: () => Promise<unknown>
  /** PLAT-72：清空模型的提交结果（默认成功；抛错用于验证行内失败）。 */
  applyModelSync?: (providerId: string, plan: unknown) => Promise<unknown>
  /** PLAT-63：行内端点探测复用同一通道的 `endpointTest` 参数（需要断言入参）。 */
  testConnection?: (providerId: string, options?: unknown) => Promise<unknown>
  /**
   * PLAT-82：每个模型的检测结果（默认 `ok`）。返回 `'pending'` 表示测试自己用
   * `emitModelDetectionProgress` / `emitModelDetectionDone` 驱动这一条。
   */
  detectionResult?: (providerId: string, modelId: string, modes: readonly string[]) => DetectionResultFixture | 'pending'
  /** 整体替换 `detectModels`（需要自己发 progress/done 时用）。 */
  detectModels?: (providerId: string, request: { modes: string[]; runId: string }) => Promise<{ accepted: boolean; total: number }>
  removeModel?: (providerId: string, modelId: string) => Promise<unknown>
  remove?: (providerId: string) => Promise<unknown>
  settings?: Partial<AppSettings>
  language?: AppLanguage
  provider?: Partial<SafeModelProvider>
  providers?: SafeModelProvider[]
} = {}): Promise<{
  api: PlatformApiMock
  container: HTMLDivElement
  root: Root
}> {
  const api = installPlatform(options)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(AppShell))
    await Promise.resolve()
  })
  const text = platformText[options.language ?? 'en-US']
  await clickButton(container, text.nav.settings)
  await clickButton(container, text.settings.modelService)
  await vi.waitFor(() => expect(container.querySelector('.settings-workspace')).not.toBeNull())
  return { api, container, root }
}

export function apiKeyInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.provider-api-key-input input')
  if (!input) throw new Error('Expected API Key input.')
  return input
}

export async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!button) throw new Error(`Expected ${label} button.`)
  await act(async () => button.click())
}

/**
 * PLAT-81（R3）：端点默认**折叠成一行摘要**，折叠态没有任何输入框。
 * 需要断言/输入端点地址的用例先调用它展开编辑行（点「编辑」）。
 */
export async function expandEndpointEditor(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>('[data-endpoint-edit]')
  if (!button) return
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(container.querySelector('[data-endpoint-input]')).not.toBeNull())
}

/** PLAT-81（R2）：删除供应商等次要操作收进品牌块 `⋯`，先展开菜单。 */
export async function openProviderMoreMenu(container: HTMLElement): Promise<void> {
  const trigger = container.querySelector<HTMLButtonElement>('[data-provider-more]')
  if (!trigger) throw new Error('Expected the provider ⋯ menu trigger.')
  await act(async () => {
    trigger.click()
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(container.querySelector('[data-provider-more-menu]')).not.toBeNull())
}

/** React 的 onBlur 走 focusout（冒泡），用它模拟真实的焦点移出。 */
export async function blurElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await Promise.resolve()
  })
}

export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
