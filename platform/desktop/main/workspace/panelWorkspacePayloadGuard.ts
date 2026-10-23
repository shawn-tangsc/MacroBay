import type { PanelContainerMode, WorkspaceSize } from '@platform/workspace/contracts'
import { WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import { timeZoneIdPattern } from '@platform/settings/schema/appSettings'
import type { WorkspaceWindowRecord } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06c 从 `panelWorkspaceIpcHandlers.ts` 拆出的 payload 守卫：
 * renderer → Main 的命令/生命周期 payload 在这里被判定为「可读纯对象 + 白名单字段 + 白名单取值」，
 * 任何多余字段、访问器属性、自定义原型、超长/非法取值都在进入 runtime store 之前被拒绝。
 * 本模块是纯函数 + 冻结常量：不 import electron、不持有状态、不读 snapshot。
 */

export type WorkspaceHostLifecyclePhase =
  | 'source-prepared' | 'target-ready' | 'source-released' | 'source-invalid' | 'window-failure' | 'native-close'

/** 每方法允许的额外字段；`method`/`requestId`/`expectedRevision` 与归属声明是所有命令共有的。 */
export const MUTATION_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  openWorkspace: ['pageId'],
  openPanel: ['workspaceInstanceKey', 'panelId', 'bindingKey', 'newInstance'],
  bindPanel: ['panelInstanceKey', 'bindingKey'],
  activatePanel: ['panelInstanceKey'],
  closePanel: ['panelInstanceKey'],
  switchContainer: ['panelInstanceKey', 'mode'],
  resizePanel: ['panelInstanceKey', 'dockSize'],
  resetPanelSize: ['panelInstanceKey'],
  reopenPanel: ['panelInstanceKey'],
  // P1-06d：分离意图只允许携带面板实例键；目标窗口身份、bounds、lastValidDock 一律由 Main 从
  // registry/store 补齐，renderer 不能自选目标（也不允许传 operationId 直接认领飞事务）。
  detachPanel: ['panelInstanceKey'],
  // PLAT-40：回停靠同样只允许携带面板实例键（目标停靠模式由 Main 按 lastValidDock + supportedModes 收敛）。
  redockPanel: ['panelInstanceKey']
})
export const COMMON_FIELDS = ['method', 'requestId', 'expectedRevision', 'windowInstanceId', 'hostEpoch'] as const
export const MAX_ID_LENGTH = 200
export const LIFECYCLE_PHASES: readonly WorkspaceHostLifecyclePhase[] = [
  'source-prepared', 'target-ready', 'source-released', 'source-invalid', 'window-failure', 'native-close'
]
export const LANGUAGE_PATTERN = /^[a-zA-Z]{2}(?:-[a-zA-Z0-9]{2,8})*$/
export const THEMES = ['light', 'dark', 'system'] as const
/**
 * 已解析时区 id 的判据来自共享契约（`timeZoneIdPattern`）：不复用 `safePreference`，它的 32 字符上限
 * 对合法 IANA id 太短（`America/Argentina/ComodRivadavia` 正好 32）。
 */
export const TIME_ZONE_PATTERN = timeZoneIdPattern

/** 只读纯对象：拒绝数组/自定义原型/访问器属性/白名单外字段（含 symbol 键）。 */
export function plainRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return null
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor)) return null
  }
  return value as Record<string, unknown>
}

export function requiredString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH ? value : null
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined | null {
  if (input[key] === undefined) return undefined
  return requiredString(input, key)
}

export function requiredRevision(input: Record<string, unknown>): number | null {
  const value = input.expectedRevision
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function requiredSize(input: Record<string, unknown>, key: string): WorkspaceSize | null {
  const size = plainRecord(input[key], ['width', 'height'])
  if (!size) return null
  const { width, height } = size
  if (typeof width !== 'number' || !Number.isFinite(width) || typeof height !== 'number' || !Number.isFinite(height)) return null
  return { width, height }
}

export function requiredMode(input: Record<string, unknown>): PanelContainerMode | null {
  const value = input.mode
  return typeof value === 'string' && (WorkspaceRegistrationPolicy.modes as readonly string[]).includes(value)
    ? value as PanelContainerMode
    : null
}

export function safePreference(value: unknown, fallback: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return fallback
  if (pattern) return pattern.test(value) ? value : fallback
  return (THEMES as readonly string[]).includes(value) ? value : fallback
}

/** 上下文里的时区只接受形状合法的 id，其余一律回落（绝不把非法值送到渲染层格式化）。 */
export function safeTimeZone(value: unknown, fallback: string): string {
  return typeof value === 'string' && TIME_ZONE_PATTERN.test(value) ? value : fallback
}

/**
 * 命令 → 允许字段集。只认自有键：若走 `MUTATION_FIELDS[method]` 直查，`method:'toString'` 会命中
 * 原型链上的函数并被当成合法方法名，随后展开它直接抛 TypeError（异常不是 fail closed）。
 */
export function commandFieldAllowlist(method: string): readonly string[] | null {
  const fields = Object.hasOwn(MUTATION_FIELDS, method) ? MUTATION_FIELDS[method] : undefined
  return fields === undefined ? null : [...COMMON_FIELDS, ...fields]
}

export function isLifecyclePhase(value: unknown): value is WorkspaceHostLifecyclePhase {
  return typeof value === 'string' && (LIFECYCLE_PHASES as readonly string[]).includes(value)
}

/** payload 声明的宿主身份必须与 registry 记录逐字一致，否则视为伪造/陈旧。 */
export function claimMatchesHost(input: Record<string, unknown>, record: WorkspaceWindowRecord): boolean {
  const claimedWindow = optionalString(input, 'windowInstanceId')
  if (claimedWindow === null) return false
  if (claimedWindow !== undefined && claimedWindow !== record.windowInstanceId) return false
  const claimedEpoch = input.hostEpoch
  if (claimedEpoch !== undefined && (typeof claimedEpoch !== 'number' || claimedEpoch !== record.hostEpoch)) return false
  return true
}
