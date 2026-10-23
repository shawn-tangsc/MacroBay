import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

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
