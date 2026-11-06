/**
 * 频道的新建与编辑（需求 v7 六字段里的三项在这里落库）。
 *
 * 三项的存储只有一处：`agent_channels` 那一行。管理服务写它，旧读模型
 * （`createAgentPlatformRepositories`）也读它——不存在「两边各存一份」。
 *
 * 语义（与 `channelSettingsInputs` 同一套）：
 * - 工作目录缺省＝系统默认目录；
 * - 允许的会话 ID 缺省／空＝**允许所有**，落库存 `null` 而不是 `'[]'`；
 * - 权限模式缺省／`null`＝继承助手，**不落 `'default'`**。
 */
import { randomUUID } from 'node:crypto'

import type { ChannelManagementRepository } from './ChannelManagementRepository'
import type { ChannelManagementResult } from './ChannelManagementContracts'
import { assertIdentifier } from './ChannelManagementContracts'
import { assertManagedChannelType, parseAllowedChatIds, parsePermissionMode, parseWorkspace } from './channelSettingsInputs'

export type ChannelMutationDeps = {
  repository: ChannelManagementRepository
  now: () => string
  /** 编辑会停掉当前运行时（既有行为：改完要重新启用）。 */
  stopRuntime: (id: string) => void
  /** 「可改」判定（删除中、隔离平台的通道不许改）在服务里，这里只调用。 */
  requireMutableChannel: (id: unknown) => string
}

export function createManagedChannel(deps: ChannelMutationDeps, input: {
    type?: unknown
    name: unknown
    agentId: unknown
    actorId: unknown
    workspace?: unknown
    allowedChatIds?: unknown
    permissionMode?: unknown
  }): ChannelManagementResult {
    if (Object.hasOwn(input, 'id')) throw new Error('channel-input-invalid')
    const id = randomUUID()
    const type = assertManagedChannelType(input.type)
    const agentId = assertIdentifier(input.agentId)
    const actorId = assertIdentifier(input.actorId)
    if (!deps.repository.agentExists(agentId)) return { ok: false, code: 'channel-agent-missing' }

    const now = deps.now()
    const created = deps.repository.create({
      id,
      type,
      name: assertIdentifier(input.name, 120),
      agentId,
      now,
      workspace: parseWorkspace(input.workspace),
      allowedChatIds: parseAllowedChatIds(input.allowedChatIds) ?? [],
      // 缺省＝继承（null），绝不落助手级默认 'default'。
      permissionMode: parsePermissionMode(input.permissionMode) ?? null
    })
    if (!created) {
      return { ok: false, code: 'channel-not-found' }
    }
    deps.repository.audit(id, actorId, 'create', null, now)
    return { ok: true, code: 'configuration-ready', channel: deps.repository.query.get(id) ?? undefined }
}

export function updateManagedChannel(deps: ChannelMutationDeps, input: {
    id: unknown
    name: unknown
    agentId: unknown
    actorId: unknown
    workspace?: unknown
    allowedChatIds?: unknown
    permissionMode?: unknown
  }): ChannelManagementResult {
    const id = deps.requireMutableChannel(input.id)
    const actorId = assertIdentifier(input.actorId)
    const agentId = assertIdentifier(input.agentId)
    if (!deps.repository.agentExists(agentId)) return { ok: false, code: 'channel-agent-missing' }

    const patch = {
      name: assertIdentifier(input.name, 120),
      agentId,
      now: deps.now(),
      ...(input.workspace === undefined ? {} : { workspace: parseWorkspace(input.workspace) }),
      ...(parseAllowedChatIds(input.allowedChatIds) === undefined ? {} : { allowedChatIds: parseAllowedChatIds(input.allowedChatIds)! }),
      ...(parsePermissionMode(input.permissionMode) === undefined ? {} : { permissionMode: parsePermissionMode(input.permissionMode)! })
    }
    const ok = deps.repository.update(id, patch)
    if (ok) deps.stopRuntime(id)
    deps.repository.audit(id, actorId, 'update', ok ? null : 'channel-not-found', deps.now())
    return ok ? { ok: true, code: 'updated', channel: deps.repository.query.get(id) ?? undefined } : { ok: false, code: 'channel-not-found' }
}
