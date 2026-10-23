import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import type { LocalizedText, ProductManifest, ProductMenuPageContribution, ProductWorkspacePanelContribution } from '@platform/product-manifest'
import type { BindingPolicy, PanelContainerMode, WorkspaceLifecycleEventType, WorkspaceSize } from '@platform/workspace/contracts'
import { WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
// 循环导入：本模块与流源桩模块互引，但双方**只在函数体内**读取对方导出（模块求值期零读取）⇒ 无害。
import { createWorkspaceTestFixtureAgentSeed } from './workspaceTestFixtureStream'
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

/**
 * Owner: platform/desktop/main（PLAT-33 一等 test-only seam）。权威：PLAT-13/14/15/16/17/18 的「无产品侧面板 /
 * 无模型服务 ⇒ 真机无法驱动」缺口，以及用户 2026-10-06 的「全部授权」决议。
 *
 * ── 为什么需要它 ──
 * 真机 `productPanelEntries=[]`（两个产品清单都没有 `panels` 贡献）⇒ A-T05 / A-T04-父子双分离 / A-T08-窄屏面板帧
 * 没有可驱动的面板；临时 profile 无模型服务 ⇒ A-T09 真机流连续性无法驱动；真机只有 7 个单实例一级页 ⇒ 八窗上限
 * 不可构造。产品侧仍受硬边界保护（本包**不读改** `products/**`），因此把缺口开在这里。
 *
 * ── 语义（四条硬性质）──
 *  0) **test-only、打包态禁用（PLAT-38）**：`isPackaged === true`（组合根传入 `app.isPackaged`）⇒ **整体忽略**
 *     该 env：不读文件、不投影清单、不注册驱动、不装钩子（env 非法也不抛错）；仅开发/测试态可用；
 *  1) **env-gated**：只有 **开发/测试态** 下 `DSH_WORKSPACE_TEST_FIXTURES`（绝对路径 JSON）命中时才生效；
 *  2) **生产零影响**：env 未设置 ⇒ 返回显式 disabled 对象，**不读文件系统、不注册清单、不注册驱动、不装钩子**
 *     ⇒ app.ts 的注入点逐字退化为原行为（零长度清单短路 + 原驱动注册分支）；
 *  3) **fail closed，绝不半开**：env 命中但 fixture 非法（相对路径 / 读不到 / 不可解析 / 结构不合法）⇒
 *     **构造期抛错**，绝不「部分注入」。
 *
 * ── 注入物只有两件，且都走平台既有入口 ──
 *  · 受控 **fixture 清单**：投影成平台既有的 `ProductManifest` 形状（页面 module 与 `toProductWorkspacePage`
 *    的推导逐字一致、面板 `pageIds` 与 `toProductPanelRegistration` 的前缀推导一致、`serviceRoutes: []`
 *    ⇒ **不新增任何产品 IPC 方法**），经既有 `bootstrapDesktopApp({ productManifests })` 组合点进入 compose；
 *  · 受控 **流源驱动桩**：实现既有 `AgentRuntimeDriver` 契约，经既有 `RuntimeDriverRegistry.register` 注册点
 *    进入（与 `createTaskAutomationSmokeDriver` 同一姿态），**不写任何假 provider、不发任何网络请求**。
 */

export const WORKSPACE_TEST_FIXTURES_ENV = 'DSH_WORKSPACE_TEST_FIXTURES'
export const WORKSPACE_TEST_FIXTURES_KIND = 'dsh-workspace-test-fixtures@1'
export const WORKSPACE_TEST_FIXTURES_GLOBAL_KEY = '__DSH_WORKSPACE_TEST_FIXTURES__'
export const WORKSPACE_TEST_FIXTURE_PRODUCT_ID = 'dsh-fixture'
export const WORKSPACE_TEST_STREAM_AGENT_ID = 'dsh-fixture-stream-agent'
export const WORKSPACE_TEST_STREAM_SESSION_ID = 'dsh-fixture-stream-session'
export const WORKSPACE_TEST_STREAM_WORKSPACE_ID = 'dsh-fixture-stream-workspace'

export type WorkspaceTestStreamStubDeclaration = {
  chunkCount: number
  chunkIntervalMs: number
  finalText: string
}

export type WorkspaceTestFixtures = {
  enabled: boolean
  path: string | null
  productManifests: readonly ProductManifest[]
  streamStub: WorkspaceTestStreamStubDeclaration | null
  agentSeed: AgentStoreSeed | null
}

type FixtureDependencies = {
  readFile?: (path: string) => string
  now?: () => Date
  /** PLAT-38：宿主事实 `app.isPackaged`，**必须由组合根（`app.ts` 注入点）逐字传入**（本模块刻意不 import
   *  `electron`，保持纯校验可测）。`true` ⇒ 打包态 ⇒ 整个 test-only env 被忽略；未传 = 开发/测试形态。 */
  isPackaged?: boolean
}

export const WORKSPACE_TEST_FIXTURES_POLICY = {
  owner: 'platform/desktop/main/workspaceTestFixtures',
  source: 'WorkspaceTestFixturesSeam',
  defaultOrLimit: 'Unset environment yields the disabled seam object and touches no file.',
  failure: 'An invalid fixture declaration throws at construction; injection is never partial.',
  packaged: 'Test-only: app.isPackaged === true ignores the environment entirely (no file read, no injection).',
  testBoundary: 'platform/desktop/main/workspaceTestFixtures.test.ts'
} as const

const disabledFixtures: WorkspaceTestFixtures = Object.freeze({
  enabled: false,
  path: null,
  productManifests: Object.freeze([]) as readonly ProductManifest[],
  streamStub: null,
  agentSeed: null
})

const allowedModes: readonly PanelContainerMode[] = WorkspaceRegistrationPolicy.modes
const dockModes = Object.freeze(['embedded', 'docked-right', 'docked-bottom'] as const)
type DockMode = (typeof dockModes)[number]

/**
 * 受控清单的**唯一**追加点（纯函数）：seam 未命中（零长度）⇒ 逐字返回入参本身（**不复制数组、不改顺序/身份**），
 * 因此既有解析入口 `resolveBootstrapProductManifests` 的调用点与未命中时的行为都逐字不变。
 */
export function appendWorkspaceTestFixtureManifests(
  productManifests: readonly ProductManifest[],
  testFixtureManifests: readonly ProductManifest[]
): readonly ProductManifest[] {
  if (testFixtureManifests.length === 0) return productManifests
  return [...productManifests, ...testFixtureManifests]
}

/** env 未设置 ⇒ 逐字等价的 disabled 对象（**不触碰文件系统**）；命中但非法 ⇒ 抛错（fail closed）。
 *  PLAT-38：`isPackaged === true` ⇒ 在读取 env **之前**返回 disabled（不读文件、不校验、不抛错、不注入）。 */
export function resolveWorkspaceTestFixtures(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  dependencies: FixtureDependencies = {}
): WorkspaceTestFixtures {
  if (dependencies.isPackaged === true) return disabledFixtures
  const raw = environment[WORKSPACE_TEST_FIXTURES_ENV]
  if (raw === undefined || raw.trim().length === 0) return disabledFixtures

  const path = raw.trim()
  if (!isAbsolute(path)) fail('absolute', `fixture path must be absolute, received "${path}"`)
  const readFile = dependencies.readFile ?? ((target: string) => readFileSync(target, 'utf8'))
  let content: string
  try {
    content = readFile(path)
  } catch (error) {
    fail('unreadable', `fixture file is unreadable: ${String((error as Error)?.message ?? error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    fail('not-json', `fixture file is not valid JSON: ${String((error as Error)?.message ?? error)}`)
  }
  return materializeFixtures(path, parsed as Record<string, unknown>, dependencies)
}

/** 受控清单 + 受控流源 + 受控 agent/session 种子（全部显式 test-only）。 */
function materializeFixtures(path: string, value: Record<string, unknown>, dependencies: FixtureDependencies): WorkspaceTestFixtures {
  if (!isRecord(value)) fail('kind', 'fixture root must be a plain object')
  if (value.kind !== WORKSPACE_TEST_FIXTURES_KIND) {
    fail('kind', `fixture kind must be "${WORKSPACE_TEST_FIXTURES_KIND}", received "${String(value.kind)}"`)
  }
  const productId = value.productId === undefined ? WORKSPACE_TEST_FIXTURE_PRODUCT_ID : value.productId
  if (typeof productId !== 'string' || !WorkspaceRegistrationPolicy.localIdPattern.test(productId)) {
    fail('productId', 'fixture productId must be a platform-stable local id')
  }
  if (!Array.isArray(value.pages) || value.pages.length === 0) fail('pages', 'fixture must declare at least one menu page')
  const pages = Object.freeze((value.pages as unknown[]).map((page, index) => projectPage(productId, page, index)))
  const declaredPanels = value.panels === undefined ? [] : value.panels
  if (!Array.isArray(declaredPanels)) fail('panels', 'fixture panels must be an array when present')
  const panels = Object.freeze((declaredPanels as unknown[]).map((panel, index) => projectPanel(productId, panel, index, pages)))
  const streamStub = value.streamStub === undefined ? null : projectStreamStub(value.streamStub)

  const fixtureProductName = typeof value.productName === 'string'
    ? value.productName
    : 'PLAT-33 workspace test fixtures (test-only)'

  const manifest: ProductManifest = Object.freeze({
    id: productId,
    // 测试夹具只声明一个名字，两个语言共用，避免测试数据本身引入语言分支。
    name: Object.freeze({ 'zh-CN': fixtureProductName, 'en-US': fixtureProductName }),
    version: '0.0.0-test-only',
    description: 'Injected by the PLAT-33 test-only seam (DSH_WORKSPACE_TEST_FIXTURES). Never present in production.',
    shellContributions: Object.freeze({ menuPages: pages, settingsSections: Object.freeze([]), panels }),
    routes: Object.freeze([]),
    navigation: Object.freeze([]),
    settingsSections: Object.freeze([]),
    serviceRoutes: Object.freeze([]),
    tools: Object.freeze([]),
    skills: Object.freeze([]),
    agents: Object.freeze([]),
    workflows: Object.freeze([]),
    policies: Object.freeze([]),
    evaluations: Object.freeze([]),
    jobHandlers: Object.freeze([]),
    migrations: Object.freeze([])
  })

  return Object.freeze({
    enabled: true,
    path,
    productManifests: Object.freeze([manifest]),
    streamStub,
    agentSeed: createWorkspaceTestFixtureAgentSeed((dependencies.now ?? (() => new Date()))().toISOString())
  })
}

function projectPage(productId: string, value: unknown, index: number): ProductMenuPageContribution {
  const label = `pages[${index}]`
  if (!isRecord(value)) fail('pages', `${label} must be a plain object`)
  requireLocalId(value.id, 'pages', `${label}.id`)
  const title = requireLocalizedText(value.title, 'pages', `${label}.title`)
  if (typeof value.icon !== 'string' || value.icon.length === 0) fail('pages', `${label}.icon must be a non-empty string`)
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) fail('pages', `${label}.order must be a finite number`)
  return Object.freeze({
    id: value.id as string,
    title,
    icon: value.icon,
    order: value.order,
    // 页面 module 必须逐字等于 `${productId}.${pageId}`（与 `toProductWorkspacePage` 同一推导，否则 allowlist 拒绝）。
    module: `${productId}.${String(value.id)}`,
    workspace: Object.freeze({
      supportsDetached: value.supportsDetached !== false,
      allowMultipleInstances: value.allowMultipleInstances === true
    })
  })
}

function projectPanel(productId: string, value: unknown, index: number, pages: readonly ProductMenuPageContribution[]): ProductWorkspacePanelContribution {
  const label = `panels[${index}]`
  if (!isRecord(value)) fail('panels', `${label} must be a plain object`)
  requireLocalId(value.id, 'panels', `${label}.id`)
  requireLocalId(value.pageId, 'pageId', `${label}.pageId`)
  if (!pages.some((page) => page.id === value.pageId)) fail('pageId', `${label}.pageId must reference a declared fixture page`)
  if (typeof value.icon !== 'string' || value.icon.length === 0) fail('panels', `${label}.icon must be a non-empty string`)
  if (!Array.isArray(value.supportedModes) || value.supportedModes.length === 0) {
    fail('supportedModes', `${label}.supportedModes must be a non-empty array`)
  }
  const declared = value.supportedModes as unknown[]
  const modes = declared.filter((mode): mode is PanelContainerMode => typeof mode === 'string' && allowedModes.includes(mode as PanelContainerMode))
  if (modes.length !== declared.length) fail('supportedModes', `${label}.supportedModes contains an unknown mode`)
  if (typeof value.defaultMode !== 'string' || !dockModes.includes(value.defaultMode as DockMode)) {
    fail('defaultMode', `${label}.defaultMode must be a dock mode (detached is never a default)`)
  }
  if (!modes.includes(value.defaultMode as PanelContainerMode)) fail('defaultMode', `${label}.defaultMode must be declared in supportedModes`)
  return Object.freeze({
    id: value.id as string,
    title: requireLocalizedText(value.title, 'panels', `${label}.title`),
    icon: value.icon,
    // `toProductPanelRegistration` 会把 module **强制**推导为 `${productId}.${id}`；这里给同一值以免误用声明值。
    module: `${productId}.${String(value.id)}`,
    pageIds: Object.freeze([value.pageId as string]),
    supportedModes: Object.freeze(modes),
    defaultMode: value.defaultMode as DockMode,
    allowMultipleInstances: value.allowMultipleInstances !== false,
    minSize: projectSize(value.minSize, 'panels', `${label}.minSize`, WorkspaceRegistrationPolicy.minSize),
    preferredSize: projectSize(value.preferredSize, 'panels', `${label}.preferredSize`, WorkspaceRegistrationPolicy.preferredSize),
    binding: Object.freeze({ persistence: 'none', maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes }) as BindingPolicy,
    lifecycleEvents: Object.freeze(['open', 'close']) as readonly WorkspaceLifecycleEventType[]
  })
}

function projectStreamStub(value: unknown): WorkspaceTestStreamStubDeclaration {
  if (!isRecord(value)) fail('streamStub', 'streamStub must be a plain object')
  const chunkCount = value.chunkCount
  if (typeof chunkCount !== 'number' || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 64) {
    fail('chunkCount', 'streamStub.chunkCount must be an integer in [1, 64]')
  }
  const chunkIntervalMs = value.chunkIntervalMs
  if (typeof chunkIntervalMs !== 'number' || !Number.isFinite(chunkIntervalMs) || chunkIntervalMs < 0 || chunkIntervalMs > 5_000) {
    fail('chunkIntervalMs', 'streamStub.chunkIntervalMs must be a finite number in [0, 5000]')
  }
  if (typeof value.finalText !== 'string' || value.finalText.length === 0) {
    fail('finalText', 'streamStub.finalText must be a non-empty string')
  }
  return Object.freeze({ chunkCount, chunkIntervalMs, finalText: value.finalText })
}

function projectSize(value: unknown, code: string, label: string, fallback: WorkspaceSize): WorkspaceSize {
  if (value === undefined) return Object.freeze({ ...fallback })
  if (!isRecord(value) || typeof value.width !== 'number' || typeof value.height !== 'number'
    || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) {
    fail(code, `${label} must be a positive size`)
  }
  return Object.freeze({ width: value.width as number, height: value.height as number })
}

function requireLocalizedText(value: unknown, code: string, label: string): LocalizedText {
  if (!isRecord(value) || typeof value['zh-CN'] !== 'string' || typeof value['en-US'] !== 'string'
    || (value['zh-CN'] as string).length === 0 || (value['en-US'] as string).length === 0) {
    fail(code, `${label} must carry non-empty zh-CN and en-US text`)
  }
  return Object.freeze({ 'zh-CN': value['zh-CN'] as string, 'en-US': value['en-US'] as string })
}

function requireLocalId(value: unknown, code: string, label: string): void {
  if (typeof value !== 'string' || !WorkspaceRegistrationPolicy.localIdPattern.test(value)) {
    fail(code, `${label} must be a platform-stable local id`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(code: string, message: string): never {
  throw new Error(`workspace-test-fixtures-${code}: ${message}`)
}

/**
 * 流源桩（受控 agent/session 种子 + `AgentRuntimeDriver` 桩 + test-only 计数钩子）拆到独立模块，
 * 这里**原样再导出** ⇒ `app.ts` 等调用方只依赖本入口，导入路径与注入点零改动。
 */
export {
  createWorkspaceTestFixtureAgentSeed,
  createWorkspaceTestStreamDriver,
  installWorkspaceTestFixtureHandle,
  type WorkspaceTestStreamStats
} from './workspaceTestFixtureStream'
