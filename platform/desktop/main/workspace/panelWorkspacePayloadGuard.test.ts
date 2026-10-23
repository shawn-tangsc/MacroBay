import { describe, expect, it } from 'vitest'

import { WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import type { WorkspaceWindowRecord } from './workspaceWindowRegistry'
import {
  COMMON_FIELDS,
  LANGUAGE_PATTERN,
  LIFECYCLE_PHASES,
  MAX_ID_LENGTH,
  MUTATION_FIELDS,
  THEMES,
  claimMatchesHost,
  commandFieldAllowlist,
  isLifecyclePhase,
  optionalString,
  plainRecord,
  requiredMode,
  requiredRevision,
  requiredSize,
  requiredString,
  safePreference
} from './panelWorkspacePayloadGuard'

/**
 * Owner: platform/desktop/main/workspace。P1-06c 从 `panelWorkspaceIpcHandlers.ts` 拆出的 payload 守卫：
 * 只读纯对象判定、逐字段类型/长度/白名单、方法 → 字段白名单、宿主归属声明比对、偏好白名单。
 * 纯函数直测，不经过 IPC；handler 侧的集成断言仍在 panelWorkspaceIpcHandlers.test.ts。
 */

const record = (overrides: Partial<WorkspaceWindowRecord> = {}): WorkspaceWindowRecord => ({
  windowInstanceId: 'window-1', hostEpoch: 2, kind: 'detached-panel',
  webContentsId: 7, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1', ...overrides
})

describe('plainRecord', () => {
  it('只接受白名单键的只读纯对象（含 null 原型）', () => {
    const value = Object.freeze({ requestId: 'r', expectedRevision: 0 })
    expect(plainRecord(value, ['requestId', 'expectedRevision'])).toBe(value)
    const nullPrototype = Object.assign(Object.create(null), { requestId: 'r' })
    expect(plainRecord(nullPrototype, ['requestId'])).toBe(nullPrototype)
  })

  it('拒绝数组、null、标量、自定义原型、访问器属性、白名单外字段与 symbol 键', () => {
    expect(plainRecord([], ['requestId'])).toBeNull()
    expect(plainRecord(null, ['requestId'])).toBeNull()
    expect(plainRecord('requestId', ['requestId'])).toBeNull()
    expect(plainRecord(7, ['requestId'])).toBeNull()
    expect(plainRecord(new Date(), ['requestId'])).toBeNull()
    expect(plainRecord(Object.create({ requestId: 'r' }), ['requestId', 'toString'])).toBeNull()
    expect(plainRecord({ url: 'file:///etc/passwd' }, ['requestId'])).toBeNull()
    const accessor: Record<string, unknown> = {}
    Object.defineProperty(accessor, 'requestId', { get: () => 'r', enumerable: true })
    expect(plainRecord(accessor, ['requestId'])).toBeNull()
    const symbolKeyed: Record<string, unknown> = { requestId: 'r' }
    Object.defineProperty(symbolKeyed, Symbol('hidden'), { value: 1, enumerable: true })
    expect(plainRecord(symbolKeyed, ['requestId'])).toBeNull()
  })
})

describe('字段校验', () => {
  it('requiredString 只接受非空、去空白非空且不超上界的字符串', () => {
    expect(requiredString({ requestId: 'req-1' }, 'requestId')).toBe('req-1')
    expect(requiredString({ requestId: ` ${'x'.repeat(MAX_ID_LENGTH - 2)} ` }, 'requestId')).toHaveLength(MAX_ID_LENGTH)
    expect(requiredString({ requestId: '' }, 'requestId')).toBeNull()
    expect(requiredString({ requestId: '   ' }, 'requestId')).toBeNull()
    expect(requiredString({ requestId: 'x'.repeat(MAX_ID_LENGTH + 1) }, 'requestId')).toBeNull()
    expect(requiredString({ requestId: 7 }, 'requestId')).toBeNull()
    expect(requiredString({}, 'requestId')).toBeNull()
  })

  it('optionalString 区分「缺省」与「存在但非法」', () => {
    expect(optionalString({}, 'bindingKey')).toBeUndefined()
    expect(optionalString({ bindingKey: 'k' }, 'bindingKey')).toBe('k')
    expect(optionalString({ bindingKey: '' }, 'bindingKey')).toBeNull()
    expect(optionalString({ bindingKey: 7 }, 'bindingKey')).toBeNull()
  })

  it('requiredRevision 只接受非负安全整数，绝不做字符串/浮点转换', () => {
    expect(requiredRevision({ expectedRevision: 0 })).toBe(0)
    expect(requiredRevision({ expectedRevision: 42 })).toBe(42)
    expect(requiredRevision({ expectedRevision: -1 })).toBeNull()
    expect(requiredRevision({ expectedRevision: 1.5 })).toBeNull()
    expect(requiredRevision({ expectedRevision: '0' })).toBeNull()
    expect(requiredRevision({ expectedRevision: Number.MAX_SAFE_INTEGER + 1 })).toBeNull()
    expect(requiredRevision({})).toBeNull()
  })

  it('requiredSize 只做有限数形状校验，正负与业务上限留给 runtime store', () => {
    expect(requiredSize({ dockSize: { width: 420, height: 320 } }, 'dockSize')).toEqual({ width: 420, height: 320 })
    expect(requiredSize({ dockSize: { width: -1, height: 0 } }, 'dockSize')).toEqual({ width: -1, height: 0 })
    expect(requiredSize({ dockSize: { width: Number.NaN, height: 1 } }, 'dockSize')).toBeNull()
    expect(requiredSize({ dockSize: { width: Number.POSITIVE_INFINITY, height: 1 } }, 'dockSize')).toBeNull()
    expect(requiredSize({ dockSize: { width: '1', height: 1 } }, 'dockSize')).toBeNull()
    expect(requiredSize({ dockSize: { width: 1, height: 1, x: 0 } }, 'dockSize')).toBeNull()
    expect(requiredSize({}, 'dockSize')).toBeNull()
  })

  it('requiredMode 只接受注册策略里的容器模式', () => {
    for (const mode of WorkspaceRegistrationPolicy.modes) expect(requiredMode({ mode })).toBe(mode)
    expect(requiredMode({ mode: 'floating' })).toBeNull()
    expect(requiredMode({ mode: 7 })).toBeNull()
    expect(requiredMode({})).toBeNull()
  })
})

describe('偏好白名单', () => {
  it('语言只接受 BCP-47 形状，主题只接受平台三值，非法一律回退', () => {
    expect(safePreference('zh-CN', 'en-US', LANGUAGE_PATTERN)).toBe('zh-CN')
    expect(safePreference('en', 'en-US', LANGUAGE_PATTERN)).toBe('en')
    expect(safePreference('zh_CN', 'en-US', LANGUAGE_PATTERN)).toBe('en-US')
    expect(safePreference('<script>', 'en-US', LANGUAGE_PATTERN)).toBe('en-US')
    expect(safePreference('x'.repeat(33), 'en-US', LANGUAGE_PATTERN)).toBe('en-US')
    expect(safePreference(42, 'en-US', LANGUAGE_PATTERN)).toBe('en-US')
    expect(safePreference('', 'en-US', LANGUAGE_PATTERN)).toBe('en-US')

    for (const theme of THEMES) expect(safePreference(theme, 'system')).toBe(theme)
    expect(safePreference('neon', 'system')).toBe('system')
    expect(safePreference(undefined, 'system')).toBe('system')
    expect(safePreference('x'.repeat(33), 'system')).toBe('system')
  })
})

describe('方法与字段白名单', () => {
  it('覆盖 11 个 workspace 命令且常量冻结，不允许运行期扩展', () => {
    // PLAT-40：新增 `redockPanel`（复用既有 `workspace.command` 通道；preload 面/通道面零新增）
    expect(Object.keys(MUTATION_FIELDS)).toEqual([
      'openWorkspace', 'openPanel', 'bindPanel', 'activatePanel', 'closePanel',
      'switchContainer', 'resizePanel', 'resetPanelSize', 'reopenPanel', 'detachPanel', 'redockPanel'
    ])
    expect(Object.isFrozen(MUTATION_FIELDS)).toBe(true)
    expect(COMMON_FIELDS).toEqual(['method', 'requestId', 'expectedRevision', 'windowInstanceId', 'hostEpoch'])
    expect(MAX_ID_LENGTH).toBe(200)
    expect(THEMES).toEqual(['light', 'dark', 'system'])
  })

  it('commandFieldAllowlist 只认自有键，原型链上的方法名必须 fail closed', () => {
    expect(commandFieldAllowlist('openPanel')).toEqual([
      ...COMMON_FIELDS, 'workspaceInstanceKey', 'panelId', 'bindingKey', 'newInstance'
    ])
    expect(commandFieldAllowlist('resizePanel')).toEqual([...COMMON_FIELDS, 'panelInstanceKey', 'dockSize'])
    // PLAT-40：回停靠只允许面板实例键（mode/target 由 Main 收敛，绝不采信 renderer 自选）
    expect(commandFieldAllowlist('redockPanel')).toEqual([...COMMON_FIELDS, 'panelInstanceKey'])
    expect(commandFieldAllowlist('openUrl')).toBeNull()
    expect(commandFieldAllowlist('')).toBeNull()
    // 原型链键若被当成合法方法，会让后续 spread 抛出 TypeError（异常 ≠ fail closed）
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(commandFieldAllowlist(inherited)).toBeNull()
    }
  })

  it('hostLifecycle 阶段白名单只接受六个具名阶段', () => {
    expect(LIFECYCLE_PHASES).toEqual([
      'source-prepared', 'target-ready', 'source-released', 'source-invalid', 'window-failure', 'native-close'
    ])
    for (const phase of LIFECYCLE_PHASES) expect(isLifecyclePhase(phase)).toBe(true)
    expect(isLifecyclePhase('prepare')).toBe(false)
    expect(isLifecyclePhase('toString')).toBe(false)
    expect(isLifecyclePhase(7)).toBe(false)
  })
})

describe('归属声明比对', () => {
  it('缺省声明视为「未声明」；一旦声明就必须与 registry 记录逐字一致', () => {
    expect(claimMatchesHost({}, record())).toBe(true)
    expect(claimMatchesHost({ windowInstanceId: 'window-1', hostEpoch: 2 }, record())).toBe(true)
    expect(claimMatchesHost({ windowInstanceId: 'window-1' }, record())).toBe(true)
    expect(claimMatchesHost({ hostEpoch: 2 }, record())).toBe(true)

    expect(claimMatchesHost({ windowInstanceId: 'forged' }, record())).toBe(false)
    expect(claimMatchesHost({ windowInstanceId: '' }, record())).toBe(false)
    expect(claimMatchesHost({ windowInstanceId: 7 }, record())).toBe(false)
    expect(claimMatchesHost({ hostEpoch: 99 }, record())).toBe(false)
    expect(claimMatchesHost({ hostEpoch: '2' }, record())).toBe(false)
  })
})
