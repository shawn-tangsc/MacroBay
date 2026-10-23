import type { ProductWorkspacePanelContribution } from '../../product-manifest'
import { isShellIconId } from '../../product-registry/shellIconIds'
import { WorkspaceRegistrationError, type WorkspacePanelRegistration, type WorkspacePanelSummary } from '../contracts'
import { WorkspaceRegistrationPolicy as policy } from '../policies'

export type PanelRegistryAllowlist = { pageIds: readonly string[]; moduleIds: readonly string[] }

function requireValid(condition: unknown, field: string): asserts condition {
  if (!condition) throw new WorkspaceRegistrationError('invalid-registration', field)
}

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

function uniqueStrings(value: unknown, field: string): asserts value is string[] {
  requireValid(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, field)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  requireValid(Reflect.ownKeys(descriptors).length === value.length + 1, field)
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)]
    requireValid(descriptor && 'value' in descriptor && nonblank(descriptor.value) && !seen.has(descriptor.value), field)
    seen.add(descriptor.value)
  }
}

function size(value: unknown, field: string) {
  const candidate = record(value, field, ['width', 'height'])
  const { width, height } = candidate
  requireValid(typeof width === 'number' && Number.isFinite(width) && width > 0, field)
  requireValid(typeof height === 'number' && Number.isFinite(height) && height > 0, field)
  return Object.freeze({ width, height })
}

function validateRegistration(value: unknown, pages: Set<string>, modules: Set<string>): WorkspacePanelRegistration {
  const input = record(value, 'registration', policy.panelFields)
  requireValid(typeof input.panelId === 'string' && policy.stableIdPattern.test(input.panelId), 'panelId')
  const title = record(input.title, 'title', ['zh-CN', 'en-US'])
  requireValid(nonblank(title['zh-CN']) && nonblank(title['en-US']), 'title')
  requireValid(typeof input.icon === 'string' && isShellIconId(input.icon), 'icon')
  requireValid(typeof input.module === 'string' && policy.stableIdPattern.test(input.module) && modules.has(input.module), 'module')
  uniqueStrings(input.pageIds, 'pageIds')
  requireValid(input.pageIds.length > 0 && input.pageIds.every((id) => policy.stableIdPattern.test(id) && pages.has(id)), 'pageIds')
  uniqueStrings(input.supportedModes, 'supportedModes')
  requireValid(input.supportedModes.every((mode) => (policy.modes as readonly string[]).includes(mode)), 'supportedModes')
  requireValid(input.supportedModes.includes(policy.fallbackMode), 'supportedModes')
  requireValid(typeof input.defaultMode === 'string' && input.defaultMode !== 'detached' && input.supportedModes.includes(input.defaultMode), 'defaultMode')
  requireValid(typeof input.allowMultipleInstances === 'boolean', 'allowMultipleInstances')
  const minSize = size(input.minSize, 'minSize')
  const preferredSize = size(input.preferredSize, 'preferredSize')
  requireValid(preferredSize.width >= minSize.width && preferredSize.height >= minSize.height, 'preferredSize')
  const binding = record(input.binding, 'binding', ['persistence', 'maxKeyBytes'])
  requireValid((policy.bindingPersistence as readonly unknown[]).includes(binding.persistence), 'binding')
  requireValid(typeof binding.maxKeyBytes === 'number' && Number.isInteger(binding.maxKeyBytes)
    && binding.maxKeyBytes > 0 && binding.maxKeyBytes <= policy.maxBindingKeyBytes, 'binding')
  uniqueStrings(input.lifecycleEvents, 'lifecycleEvents')
  requireValid(input.lifecycleEvents.every((event) => (policy.lifecycleEvents as readonly string[]).includes(event)), 'lifecycleEvents')

  // 只投影契约字段；副本与输入断开引用，Main 不保留 loader/业务状态。
  return Object.freeze({
    panelId: input.panelId, title: Object.freeze({ 'zh-CN': title['zh-CN'], 'en-US': title['en-US'] }),
    icon: input.icon, module: input.module, pageIds: Object.freeze([...input.pageIds]),
    supportedModes: Object.freeze([...input.supportedModes]), defaultMode: input.defaultMode,
    allowMultipleInstances: input.allowMultipleInstances, minSize, preferredSize,
    binding: Object.freeze({ persistence: binding.persistence, maxKeyBytes: binding.maxKeyBytes }),
    lifecycleEvents: Object.freeze([...input.lifecycleEvents])
  }) as WorkspacePanelRegistration
}

/** 仅转换受信 manifest 的本地标识；模块路径由生成边界校验，运行期只认静态 ID。 */
export function toProductPanelRegistration(productId: string, contribution: ProductWorkspacePanelContribution): WorkspacePanelRegistration {
  const input = record(contribution, 'registration', [...policy.panelFields.filter((field) => field !== 'panelId'), 'id'])
  requireValid(typeof input.id === 'string' && policy.localIdPattern.test(input.id), 'panelId')
  requireValid(policy.localIdPattern.test(productId), 'productId')
  uniqueStrings(input.pageIds, 'pageIds')
  requireValid(input.pageIds.every((id) => policy.localIdPattern.test(id)), 'pageIds')
  const { id, ...fields } = contribution
  return {
    ...fields, panelId: `${productId}.${id}`, module: `${productId}.${id}`,
    pageIds: contribution.pageIds.map((pageId) => `${productId}.${pageId}`)
  }
}

export function createPanelRegistry(allowlist: PanelRegistryAllowlist) {
  const pages = new Set(allowlist.pageIds)
  const modules = new Set(allowlist.moduleIds)
  const registrations = new Map<string, WorkspacePanelRegistration>()
  let sealed = false
  let summaries: readonly WorkspacePanelSummary[] = []
  function requireSealed(): void {
    if (!sealed) throw new WorkspaceRegistrationError('registry-not-sealed')
  }
  return Object.freeze({
    register(value: unknown): void {
      if (sealed) throw new WorkspaceRegistrationError('registry-sealed')
      const registration = validateRegistration(value, pages, modules)
      if (registrations.has(registration.panelId)) throw new WorkspaceRegistrationError('duplicate-registration', 'panelId')
      registrations.set(registration.panelId, registration)
    },
    seal(): void {
      if (sealed) return
      summaries = Object.freeze([...registrations.values()].map(({ panelId, title }) => Object.freeze({
        id: panelId, kind: 'panel' as const, title
      })))
      sealed = true
    },
    get(panelId: string): Readonly<WorkspacePanelRegistration> | undefined {
      requireSealed()
      return registrations.get(panelId)
    },
    list(): readonly WorkspacePanelSummary[] {
      requireSealed()
      return summaries
    }
  })
}
