import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import type { NotificationEventDeclaration } from '../notifications/contracts/notificationEventCatalog'
import { notificationEventReasonKey, notificationEventTitleKey } from '../notifications/contracts/platformNotificationEvents'
import type {
  ProductManifest,
  ProductAssistantTemplateRegistration,
  ProductMenuPageContribution,
  ProductSettingsSectionContribution,
  ProductShellContributions
} from '../product-manifest'
import { isAssistantTemplateGroupId } from '../ai/assistant-platform/library/assistantTemplateSchemas'
import { isReservedShellRoutePath, RESERVED_SHELL_ROUTE_PATHS } from './reservedRoutes'
import { isShellIconId } from './shellIconIds'
import { createPanelRegistry, toProductPanelRegistration } from '../workspace/registry/panelRegistry'
import { WorkspaceRegistrationError } from '../workspace/contracts'

// Owner: product-registry。面板入口必须是产品内真实文件，不能以目录或 symlink 绕过 allowlist。
// 权威：工作区技术设计 §3；回归：workspaceContributions.test.ts。
const WorkspacePanelModulePolicy = {
  relativeModulePattern: /^\.\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.tsx?)?$/,
  explicitExtensionPattern: /\.tsx?$/,
  // 与 Vite 默认解析候选对齐，拒绝歧义；仅 TS/TSX 入口获准。
  resolutionExtensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  allowedExtensions: ['.ts', '.tsx']
} as const

function assertWorkspacePanelModule(productDir: string, modulePath: unknown): void {
  if (typeof modulePath !== 'string' || !WorkspacePanelModulePolicy.relativeModulePattern.test(modulePath)) {
    throw new WorkspaceRegistrationError('invalid-registration', 'module')
  }
  const base = resolve(productDir, modulePath)
  const explicit = WorkspacePanelModulePolicy.explicitExtensionPattern.test(modulePath)
  const candidates = explicit ? [base] : [base, ...WorkspacePanelModulePolicy.resolutionExtensions.flatMap((extension) => [
    `${base}${extension}`, `${base}/index${extension}`
  ])]
  const entries = candidates.filter((candidate) => {
    try { return !lstatSync(candidate).isDirectory() } catch { return false }
  })
  const [entry] = entries
  if (entries.length !== 1 || !WorkspacePanelModulePolicy.allowedExtensions.some((extension) => entry.endsWith(extension))
    || (!explicit && existsSync(resolve(base, 'package.json'))) || !existsSync(entry) || !statSync(entry).isFile()) {
    throw new WorkspaceRegistrationError('invalid-registration', 'module')
  }
  const relativePath = relative(realpathSync(productDir), realpathSync(entry))
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new WorkspaceRegistrationError('invalid-registration', 'module')
  }
}

const KEBAB_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/**
 * 事件话题的形状（`MI-11-R22` A1）：小写、点/横线分段，例如 `market-intelligence.item.created`。
 *
 * 事件总线本身只要求「非空字符串」，这里更严是**故意**的：这份目录用来给读者选订阅目标，
 * 带空格或大写的拼写错误会让任务「建得成、永远不触发」，而在生成期就报错能立刻看见。
 */
const EVENT_TOPIC_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export class ProductRegistryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductRegistryValidationError'
  }
}

export function toManifestExportName(productId: string): string {
  const camelCaseId = productId.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase())
  return `${camelCaseId}ProductManifest`
}

export function toGlobalContributionId(productId: string, localId: string): string {
  return `${productId}.${localId}`
}

export function toProductRoutePath(productId: string, pageId: string): string {
  return `/${productId}/${pageId}`
}

export function assertKebabCaseId(value: string, label: string): void {
  if (!KEBAB_CASE_PATTERN.test(value)) {
    throw new ProductRegistryValidationError(`${label} must use stable kebab-case: ${value}`)
  }
}

export function assertLocalizedText(title: ProductMenuPageContribution['title'], label: string): void {
  if (!title['zh-CN']?.trim() || !title['en-US']?.trim()) {
    throw new ProductRegistryValidationError(`${label} must include both zh-CN and en-US text`)
  }
}

const NOTIFICATION_REQUESTED_LEVELS = new Set(['toast', 'popup', 'desktop', 'channel'])
const NOTIFICATION_DEDUPE_UNITS = new Set(['occurrence', 'condition'])
const NOTIFICATION_TEMPLATE_PLACEHOLDER = /\{[a-zA-Z][a-zA-Z0-9]*\}/

/**
 * 该产品**声明**的通知事件（契约 §3）。生成期校验五条，缺一条就是「建得成、永远不响」或
 * 「合并永远合不上」——这两类毛病在运行期都只表现为读者收不到、或者收两条，静默且难查。
 *
 * 批准值不在这里校验：生效表面只读平台批准表（契约 §4），产品改了申请、平台没批，行为不变。
 */
function assertNotificationEvents(manifest: ProductManifest, productId: string): void {
  const events = manifest.notificationEvents
  if (events === undefined) return
  if (!Array.isArray(events)) {
    throw new ProductRegistryValidationError(`product "${productId}" notificationEvents must be an array`)
  }

  const seen = new Set<string>()
  for (const event of events as readonly NotificationEventDeclaration[]) {
    const id = typeof event.id === 'string' ? event.id : ''
    if (!id.startsWith(`${productId}.`) || id !== id.trim()) {
      throw new ProductRegistryValidationError(
        `product "${productId}" notification event id must start with "${productId}.", got "${id}"`
      )
    }
    if (seen.has(id)) {
      throw new ProductRegistryValidationError(`product "${productId}" declares duplicate notification event: ${id}`)
    }
    seen.add(id)

    // 键名只有一个命名空间：`notification.event.<完整 id>.*`。手写的键在事件改名时不会有人同步，
    // 目录解析出来就落空——所以**生成期**就比对期望值与实际值，不靠记性，也不留到运行期。
    assertGeneratedEventKey(id, 'titleKey', event.titleKey, notificationEventTitleKey(id))
    assertGeneratedEventKey(id, 'reasonKey', event.reasonKey, notificationEventReasonKey(id))
    const bodyBase = `notification.event.${id}.body`
    if (event.bodyKey !== undefined) {
      assertGeneratedEventKey(id, 'bodyKey', event.bodyKey, bodyBase)
    }
    if (event.bodyKeyByVariant !== undefined) {
      if (!event.bodyKeyByVariant || typeof event.bodyKeyByVariant !== 'object' || Array.isArray(event.bodyKeyByVariant)) {
        throw new ProductRegistryValidationError(`notification event "${id}" bodyKeyByVariant must be an object`)
      }
      for (const [variant, key] of Object.entries(event.bodyKeyByVariant)) {
        // 变体键与主键同一前缀：`.body.<variant>`，不开第二个命名空间。
        assertGeneratedEventKey(id, `bodyKeyByVariant.${variant}`, key, `${bodyBase}.${variant}`)
      }
    }
    if (typeof event.requiresUserAction !== 'boolean' || typeof event.notifyOnlyIfSubscribed !== 'boolean') {
      throw new ProductRegistryValidationError(
        `notification event "${id}" must declare requiresUserAction and notifyOnlyIfSubscribed as booleans`
      )
    }

    const levels = event.requestedDisruptionLevels
    if (!Array.isArray(levels) || levels.some((level) => !NOTIFICATION_REQUESTED_LEVELS.has(level))) {
      throw new ProductRegistryValidationError(
        `notification event "${id}" requestedDisruptionLevels must be a subset of toast/popup/desktop/channel`
      )
    }
    if (new Set(levels).size !== levels.length) {
      throw new ProductRegistryValidationError(`notification event "${id}" repeats a requested disruption level`)
    }

    const hasTemplate = typeof event.dedupeKeyTemplate === 'string'
    const hasBuilder = typeof event.dedupeKeyBuilder === 'string'
    if (hasTemplate === hasBuilder) {
      throw new ProductRegistryValidationError(
        `notification event "${id}" must declare exactly one of dedupeKeyTemplate or dedupeKeyBuilder`
      )
    }
    if (hasTemplate && !NOTIFICATION_TEMPLATE_PLACEHOLDER.test(event.dedupeKeyTemplate ?? '')) {
      // 常量模板 = 这个事件永远只有一条：第二次发生会并进第一次，次数也不加。
      throw new ProductRegistryValidationError(
        `notification event "${id}" dedupeKeyTemplate must contain a variable placeholder`
      )
    }
    if (hasBuilder && event.dedupeKeyBuilder !== 'moduleSignal' && event.dedupeKeyBuilder !== 'sourceIssue') {
      throw new ProductRegistryValidationError(
        `notification event "${id}" dedupeKeyBuilder must be one of the registered builders`
      )
    }

    if (!NOTIFICATION_DEDUPE_UNITS.has(event.dedupeUnit)) {
      throw new ProductRegistryValidationError(
        `notification event "${id}" dedupeUnit must be "occurrence" or "condition"`
      )
    }
    const window = event.conditionWindowMs
    const hasWindow = window !== undefined
    if (event.dedupeUnit === 'condition') {
      if (!hasWindow || !Number.isInteger(window) || (window ?? 0) <= 0) {
        throw new ProductRegistryValidationError(
          `notification event "${id}" condition cadence needs a positive integer conditionWindowMs`
        )
      }
    } else if (hasWindow) {
      // occurrence 带窗口 = 「一天」被写成了毫秒：两个概念不许挤在一个字段里。
      throw new ProductRegistryValidationError(
        `notification event "${id}" occurrence cadence must not declare conditionWindowMs`
      )
    }
    if (event.dedupeKeyTemplate !== undefined && typeof event.dedupeKeyTemplate !== 'string') {
      throw new ProductRegistryValidationError(`notification event "${id}" dedupeKeyTemplate must be a string`)
    }
    if (event.requestedBypassQuietHours !== undefined && typeof event.requestedBypassQuietHours !== 'boolean') {
      throw new ProductRegistryValidationError(`notification event "${id}" requestedBypassQuietHours must be a boolean`)
    }
  }
}

/** 期望值与实际值都写进消息：红的时候唯一被读到的就是这句话。 */
function assertGeneratedEventKey(eventTypeId: string, field: string, actual: unknown, expected: string): void {
  if (actual === expected) return
  throw new ProductRegistryValidationError(
    `notification event "${eventTypeId}" ${field} must be "${expected}" (generated from the event id), got "${String(actual)}"`
  )
}

/**
 * 该产品**发布**的话题声明（`MI-11-R22` A1）。任务的订阅校验以这份声明为目录，
 * 所以形状错误必须在生成期就报出来，而不是等到读者建任务时才发现订阅永远不命中。
 */
/**
 * 通知生产者 claim（契约 §14.1/§14.4）：只能做格式校验，做不到「声明的 id 一定存在」——
 * job 定义是运行时注册的，manifest 里没有静态清单。存在性靠 `claim-never-registered` 诊断。
 */
function assertNotificationProducerClaims(manifest: ProductManifest, productId: string): void {
  const claims = manifest.notificationProducerClaims
  if (claims === undefined) return
  if (!Array.isArray(claims)) {
    throw new ProductRegistryValidationError(`product "${productId}" notificationProducerClaims must be an array`)
  }
  const seen = new Set<string>()
  for (const claim of claims) {
    if (typeof claim !== 'string' || claim.trim() === '' || claim !== claim.trim()) {
      throw new ProductRegistryValidationError(
        `product "${productId}" notificationProducerClaims must contain non-empty trimmed strings`
      )
    }
    if (!claim.startsWith(`${productId}.`)) {
      throw new ProductRegistryValidationError(
        `product "${productId}" notificationProducerClaim must start with "${productId}.", got "${claim}"`
      )
    }
    if (seen.has(claim)) {
      throw new ProductRegistryValidationError(`product "${productId}" declares duplicate notification producer: ${claim}`)
    }
    seen.add(claim)
  }
}

function assertPublishableEventTopics(manifest: ProductManifest, productId: string): void {
  const topics = manifest.eventTopics
  if (topics === undefined) return
  if (!Array.isArray(topics)) {
    throw new ProductRegistryValidationError(`product "${productId}" eventTopics must be an array`)
  }

  const seen = new Set<string>()
  for (const topic of topics) {
    if (typeof topic !== 'string' || topic.trim() === '' || topic !== topic.trim()) {
      throw new ProductRegistryValidationError(
        `product "${productId}" eventTopics must contain non-empty trimmed strings`
      )
    }
    if (!EVENT_TOPIC_PATTERN.test(topic)) {
      throw new ProductRegistryValidationError(
        `product "${productId}" event topic must be lowercase dot or dash separated: ${topic}`
      )
    }
    if (seen.has(topic)) {
      throw new ProductRegistryValidationError(`product "${productId}" declares duplicate event topic: ${topic}`)
    }
    seen.add(topic)
  }
}

export function resolveContributionModulePath(productDir: string, modulePath: string): string {
  if (!modulePath.startsWith('./')) {
    throw new ProductRegistryValidationError(`Module path must be product-relative and start with "./": ${modulePath}`)
  }

  const normalizedModulePath = modulePath.slice(2)
  const absoluteBase = resolve(productDir, normalizedModulePath)
  const relativePath = relative(productDir, absoluteBase)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new ProductRegistryValidationError(`Module path must stay inside product directory: ${modulePath}`)
  }

  const candidates = [
    absoluteBase,
    `${absoluteBase}.ts`,
    `${absoluteBase}.tsx`,
    resolve(absoluteBase, 'index.ts'),
    resolve(absoluteBase, 'index.tsx')
  ]

  const match = candidates.find((candidate) => existsSync(candidate))
  if (!match) {
    throw new ProductRegistryValidationError(`Module path does not exist: ${modulePath}`)
  }

  return absoluteBase
}

function collectUniqueLocalIds(contributions: readonly { id: string }[], label: string): void {
  const seen = new Set<string>()
  for (const contribution of contributions) {
    if (seen.has(contribution.id)) {
      throw new ProductRegistryValidationError(`Duplicate ${label} id within product: ${contribution.id}`)
    }
    seen.add(contribution.id)
  }
}

function validateProductAssistantTemplate(contribution: ProductAssistantTemplateRegistration): void {
  assertKebabCaseId(contribution.id, `assistant template id "${contribution.id}"`)
  assertLocalizedText(contribution.name, `assistant template "${contribution.id}" name`)
  assertLocalizedText(contribution.prompt, `assistant template "${contribution.id}" prompt`)
  if (!Number.isInteger(contribution.version) || contribution.version <= 0) {
    throw new ProductRegistryValidationError(
      `assistant template "${contribution.id}" version must be a positive integer`
    )
  }
  for (const group of contribution.groups ?? []) {
    if (!isAssistantTemplateGroupId(group)) {
      throw new ProductRegistryValidationError(
        `Unknown assistant template group "${String(group)}" for "${contribution.id}"`
      )
    }
  }
  if (
    contribution.installPolicy !== undefined &&
    contribution.installPolicy !== 'library-only' &&
    contribution.installPolicy !== 'auto-install'
  ) {
    throw new ProductRegistryValidationError(
      `Invalid assistant template install policy for "${contribution.id}": ${String(contribution.installPolicy)}`
    )
  }
}

/**
 * P2-01 additive：可选 workspace 能力声明必须是纯数据对象，字段类型严格（缺省即平台默认值）。
 * 这里只做形状校验；「每个一级菜单都必须可分离」的 Phase 2 硬约束由页注册（`workspacePageRegistry`）持有。
 */
function validateMenuPageWorkspaceCapability(contribution: ProductMenuPageContribution): void {
  const declared = (contribution as { workspace?: unknown }).workspace
  if (declared === undefined) return
  const label = `menu page "${contribution.id}" workspace`
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new ProductRegistryValidationError(`${label} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(declared)
  const keys = Reflect.ownKeys(declared)
  if ((prototype !== Object.prototype && prototype !== null)
    || !keys.every((key) => key === 'supportsDetached' || key === 'allowMultipleInstances')
    || !Object.values(Object.getOwnPropertyDescriptors(declared)).every((item) => 'value' in item)) {
    throw new ProductRegistryValidationError(`${label} has unsupported fields`)
  }
  for (const field of ['supportsDetached', 'allowMultipleInstances'] as const) {
    const value = (declared as Record<string, unknown>)[field]
    if (value !== undefined && typeof value !== 'boolean') {
      throw new ProductRegistryValidationError(`${label}.${field} must be a boolean`)
    }
  }
}

function validateMenuPageContribution(
  productId: string,
  productDir: string,
  contribution: ProductMenuPageContribution,
  globalIds: Set<string>,
  routePaths: Set<string>
): void {
  assertKebabCaseId(contribution.id, `menu page id "${contribution.id}"`)
  assertLocalizedText(contribution.title, `menu page "${contribution.id}" title`)
  if (!isShellIconId(contribution.icon)) {
    throw new ProductRegistryValidationError(`Unknown shell icon "${contribution.icon}" for menu page "${contribution.id}"`)
  }

  resolveContributionModulePath(productDir, contribution.module)
  validateMenuPageWorkspaceCapability(contribution)

  const globalId = toGlobalContributionId(productId, contribution.id)
  if (globalIds.has(globalId)) {
    throw new ProductRegistryValidationError(`Duplicate global menu entry id: ${globalId}`)
  }
  globalIds.add(globalId)

  const routePath = toProductRoutePath(productId, contribution.id)
  if (isReservedShellRoutePath(routePath) || routePaths.has(routePath)) {
    throw new ProductRegistryValidationError(`Route path conflicts with reserved or existing route: ${routePath}`)
  }
  routePaths.add(routePath)
}

function validateSettingsSectionContribution(
  productId: string,
  productDir: string,
  contribution: ProductSettingsSectionContribution,
  globalIds: Set<string>
): void {
  assertKebabCaseId(contribution.id, `settings section id "${contribution.id}"`)
  assertLocalizedText(contribution.title, `settings section "${contribution.id}" title`)
  if (!isShellIconId(contribution.icon)) {
    throw new ProductRegistryValidationError(`Unknown shell icon "${contribution.icon}" for settings section "${contribution.id}"`)
  }

  resolveContributionModulePath(productDir, contribution.module)

  const globalId = toGlobalContributionId(productId, contribution.id)
  if (globalIds.has(globalId)) {
    throw new ProductRegistryValidationError(`Duplicate global settings entry id: ${globalId}`)
  }
  globalIds.add(globalId)
}

export function normalizeShellContributions(manifest: ProductManifest): ProductShellContributions {
  return manifest.shellContributions ?? { menuPages: [], settingsSections: [] }
}

export function validateDiscoveredProductManifest(
  productId: string,
  productDir: string,
  manifest: ProductManifest,
  globalMenuIds: Set<string>,
  globalSettingsIds: Set<string>,
  routePaths: Set<string>
): void {
  if (manifest.id !== productId) {
    throw new ProductRegistryValidationError(
      `Manifest id "${manifest.id}" must match product directory name "${productId}"`
    )
  }

  assertLocalizedText(manifest.name, `product "${productId}" name`)
  assertPublishableEventTopics(manifest, productId)
  assertNotificationEvents(manifest, productId)
  assertNotificationProducerClaims(manifest, productId)

  const reservedProductIds = RESERVED_SHELL_ROUTE_PATHS.map((routePath) => routePath.slice(1))
  if (reservedProductIds.includes(productId)) {
    throw new ProductRegistryValidationError(`Product id "${productId}" conflicts with a reserved shell route`)
  }

  const shellContributions = normalizeShellContributions(manifest)
  collectUniqueLocalIds(shellContributions.menuPages, 'menu page')
  collectUniqueLocalIds(shellContributions.settingsSections, 'settings section')
  const panels = shellContributions.panels ?? []
  if (!Array.isArray(panels)) throw new WorkspaceRegistrationError('invalid-registration', 'panels')
  const descriptors = Object.getOwnPropertyDescriptors(panels)
  if (Object.getPrototypeOf(panels) !== Array.prototype || Reflect.ownKeys(descriptors).length !== panels.length + 1) {
    throw new WorkspaceRegistrationError('invalid-registration', 'panels')
  }
  for (let index = 0; index < panels.length; index += 1) {
    if (!descriptors[String(index)] || !('value' in descriptors[String(index)])) {
      throw new WorkspaceRegistrationError('invalid-registration', 'panels')
    }
  }
  const registrations = panels.map((panel) => toProductPanelRegistration(productId, panel))
  const panelRegistry = createPanelRegistry({
    pageIds: shellContributions.menuPages.map((page) => toGlobalContributionId(productId, page.id)),
    moduleIds: registrations.map((panel) => panel.module)
  })
  for (const [index, panel] of panels.entries()) {
    assertWorkspacePanelModule(productDir, panel.module)
    panelRegistry.register(registrations[index])
  }
  panelRegistry.seal()
  collectUniqueLocalIds(manifest.assistantTemplates ?? [], 'assistant template')
  const serviceMethods = new Set<string>()
  for (const route of manifest.serviceRoutes) {
    const method = route.method.trim()
    if (!method || serviceMethods.has(method)) {
      throw new ProductRegistryValidationError(`Invalid or duplicate service route method: ${route.method}`)
    }
    serviceMethods.add(method)
  }

  for (const contribution of shellContributions.menuPages) {
    validateMenuPageContribution(productId, productDir, contribution, globalMenuIds, routePaths)
  }

  for (const contribution of shellContributions.settingsSections) {
    validateSettingsSectionContribution(productId, productDir, contribution, globalSettingsIds)
  }

  for (const contribution of manifest.assistantTemplates ?? []) {
    validateProductAssistantTemplate(contribution)
  }
}
