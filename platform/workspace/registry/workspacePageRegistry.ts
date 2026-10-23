import type { LocalizedText, ProductMenuPageContribution, ProductMenuPageWorkspaceCapability } from '../../product-manifest'
import { isShellIconId } from '../../product-registry/shellIconIds'
import {
  WorkspaceRegistrationError,
  type BindingPolicy,
  type WorkspacePageRegistration,
  type WorkspacePageSummary
} from '../contracts'
import { WorkspacePageRegistrationPolicy as policy, WorkspaceRegistrationPolicy } from '../policies'

/**
 * Owner: platform/workspace/registry。权威：技术设计 §3.3 / §3.4 / §8。
 * 一级菜单页统一注册（Main 纯描述权威）：
 *  - 内置三项（`builtInWorkspacePages`）+ 全部产品菜单页（`toProductWorkspacePage`）；
 *  - 只持有描述与能力，不持有 loader、React、产品数据或业务权限；
 *  - 只认静态 ID，模块在生成/内置 loader allowlist 内，绝不由 renderer 上报建立信任。
 * 旧菜单缺扩展字段时按 `WorkspacePageRegistrationPolicy` 补齐默认值；非法贡献被 typed 拒绝并诊断，
 * 但「删掉菜单」不能当作通过。
 */

export type MenuPageWorkspaceCapabilityInput = {
  workspace?: ProductMenuPageWorkspaceCapability
}
export type MenuPageWorkspaceCapability = { supportsDetached: boolean; allowMultipleInstances: boolean }

function requireValid(condition: unknown, field: string): asserts condition {
  if (!condition) throw new WorkspaceRegistrationError('invalid-registration', field)
}

/** 只接受纯数据对象：拒绝数组、自定义原型与访问器属性（与 panelRegistry 同一安全姿态）。 */
function record(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), field)
  const prototype = Object.getPrototypeOf(value)
  requireValid(prototype === Object.prototype || prototype === null, field)
  requireValid(Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key)), field)
  requireValid(Object.values(Object.getOwnPropertyDescriptors(value)).every((item) => 'value' in item), field)
  return value as Record<string, unknown>
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 产品页必须与路由路径同规则：`/productId/localPageId`；内置页 menuKey 恒等于 pageId。 */
export function toWorkspacePageId(productId: string, localPageId: string): string {
  return `${productId}.${localPageId}`
}

export function toWorkspacePageMenuKey(productId: string, localPageId: string): string {
  return `/${productId}/${localPageId}`
}

/** 旧菜单缺扩展字段时的唯一默认来源（可分离 + 单实例），产品 manifest 与 shell 投影共用。 */
export function resolveMenuPageWorkspaceCapability(input: MenuPageWorkspaceCapabilityInput): MenuPageWorkspaceCapability {
  return Object.freeze({
    supportsDetached: input.workspace?.supportsDetached ?? policy.defaultSupportsDetached,
    allowMultipleInstances: input.workspace?.allowMultipleInstances ?? policy.defaultAllowMultipleInstances
  })
}

/** 产品菜单页贡献 → 统一注册条目（只投影安全字段，Main 不保留 loader/业务状态）。 */
export function toProductWorkspacePage(productId: string, contribution: ProductMenuPageContribution): WorkspacePageRegistration {
  const capability = resolveMenuPageWorkspaceCapability(contribution)
  return Object.freeze({
    pageId: toWorkspacePageId(productId, contribution.id),
    menuKey: toWorkspacePageMenuKey(productId, contribution.id),
    title: Object.freeze({ 'zh-CN': contribution.title['zh-CN'], 'en-US': contribution.title['en-US'] }),
    icon: contribution.icon,
    module: toWorkspacePageId(productId, contribution.id),
    productId,
    supportsDetached: capability.supportsDetached,
    allowMultipleInstances: capability.allowMultipleInstances,
    binding: Object.freeze({
      persistence: policy.defaultBindingPersistence,
      maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes
    })
  })
}

export type WorkspacePageRegistryAllowlist = {
  /** 内置/产品页的 loader allowlist（静态 id，绝不由 renderer 上报）。 */
  moduleIds: readonly string[]
  /** 可选：只允许这些产品贡献菜单页（缺省表示不额外限制产品来源）。 */
  productIds?: readonly string[]
}

function validateRegistration(
  value: unknown,
  modules: Set<string>,
  products: Set<string> | null
): WorkspacePageRegistration {
  const input = record(value, 'registration', policy.pageFields)
  requireValid(typeof input.pageId === 'string' && WorkspaceRegistrationPolicy.stableIdPattern.test(input.pageId), 'pageId')
  requireValid(
    typeof input.menuKey === 'string' && input.menuKey.length <= policy.maxMenuKeyLength
      && policy.menuKeyPattern.test(input.menuKey),
    'menuKey'
  )
  requireValid(typeof input.icon === 'string' && isShellIconId(input.icon), 'icon')
  requireValid(typeof input.module === 'string' && modules.has(input.module), 'module')
  requireValid(typeof input.supportsDetached === 'boolean', 'supportsDetached')
  // Phase 2 的硬约束：每个一级菜单都必须可分离（§3.3）；不可分离的贡献在这里 fail closed。
  requireValid(input.supportsDetached === true, 'supportsDetached')
  requireValid(typeof input.allowMultipleInstances === 'boolean', 'allowMultipleInstances')

  const hasTitle = input.title !== undefined
  const hasTitleKey = input.titleKey !== undefined
  requireValid(!(hasTitle && hasTitleKey), 'titleKey')

  let title: LocalizedText | undefined
  let titleKey: string | undefined
  if (input.productId === undefined) {
    // 内置页：只有平台 shell 文案键，平台层不持有可见文案副本
    requireValid(hasTitleKey, 'titleKey')
    requireValid(!hasTitle, 'title')
    requireValid(nonblank(input.titleKey) && input.titleKey.length <= policy.maxMenuKeyLength, 'titleKey')
    titleKey = input.titleKey
    requireValid(input.menuKey === input.pageId, 'menuKey')
  } else {
    requireValid(typeof input.productId === 'string'
      && WorkspaceRegistrationPolicy.localIdPattern.test(input.productId), 'productId')
    if (products !== null) requireValid(products.has(input.productId), 'productId')
    requireValid(hasTitle, 'title')
    requireValid(!hasTitleKey, 'titleKey')
    const localized = record(input.title, 'title', ['zh-CN', 'en-US'])
    requireValid(nonblank(localized['zh-CN']) && nonblank(localized['en-US']), 'title')
    title = Object.freeze({ 'zh-CN': localized['zh-CN'] as string, 'en-US': localized['en-US'] as string })
    // 产品页的 menuKey 必须由 pageId 同规则派生，杜绝两套身份分叉
    requireValid(input.pageId.startsWith(`${input.productId}.`), 'pageId')
    requireValid(input.menuKey === toWorkspacePageMenuKey(input.productId, input.pageId.slice(input.productId.length + 1)), 'menuKey')
  }

  const binding = record(input.binding, 'binding', ['persistence', 'maxKeyBytes'])
  requireValid((WorkspaceRegistrationPolicy.bindingPersistence as readonly unknown[]).includes(binding.persistence), 'binding')
  requireValid(
    typeof binding.maxKeyBytes === 'number' && Number.isInteger(binding.maxKeyBytes)
      && binding.maxKeyBytes > 0 && binding.maxKeyBytes <= WorkspaceRegistrationPolicy.maxBindingKeyBytes,
    'binding'
  )
  const persistence = binding.persistence as BindingPolicy['persistence']
  const maxKeyBytes = binding.maxKeyBytes as number

  return Object.freeze({
    pageId: input.pageId,
    menuKey: input.menuKey,
    ...(title === undefined ? {} : { title }),
    ...(titleKey === undefined ? {} : { titleKey }),
    icon: input.icon,
    module: input.module,
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    supportsDetached: true as const,
    allowMultipleInstances: input.allowMultipleInstances,
    binding: Object.freeze({ persistence, maxKeyBytes })
  }) as WorkspacePageRegistration
}

export function createWorkspacePageRegistry(allowlist: WorkspacePageRegistryAllowlist) {
  const modules = new Set(allowlist.moduleIds)
  const products = allowlist.productIds === undefined ? null : new Set(allowlist.productIds)
  const registrations = new Map<string, WorkspacePageRegistration>()
  const menuKeys = new Map<string, string>()
  let sealed = false
  const requireSealed = (): void => {
    if (!sealed) throw new WorkspaceRegistrationError('registry-not-sealed')
  }
  return Object.freeze({
    register(value: unknown): void {
      if (sealed) throw new WorkspaceRegistrationError('registry-sealed')
      const registration = validateRegistration(value, modules, products)
      if (registrations.has(registration.pageId)) {
        throw new WorkspaceRegistrationError('duplicate-registration', 'pageId')
      }
      if (menuKeys.has(registration.menuKey)) {
        throw new WorkspaceRegistrationError('duplicate-registration', 'menuKey')
      }
      registrations.set(registration.pageId, registration)
      menuKeys.set(registration.menuKey, registration.pageId)
    },
    seal(): void {
      sealed = true
    },
    get(pageId: string): Readonly<WorkspacePageRegistration> | undefined {
      requireSealed()
      return registrations.get(pageId)
    },
    byMenuKey(menuKey: string): Readonly<WorkspacePageRegistration> | undefined {
      requireSealed()
      const pageId = menuKeys.get(menuKey)
      return pageId === undefined ? undefined : registrations.get(pageId)
    },
    list(): readonly WorkspacePageSummary[] {
      requireSealed()
      return Object.freeze([...registrations.values()].map((registration) => Object.freeze({
        id: registration.pageId,
        kind: 'page' as const,
        menuKey: registration.menuKey,
        ...(registration.title === undefined ? {} : { title: registration.title }),
        ...(registration.titleKey === undefined ? {} : { titleKey: registration.titleKey }),
        supportsDetached: registration.supportsDetached,
        allowMultipleInstances: registration.allowMultipleInstances
      })))
    }
  })
}
