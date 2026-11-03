import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import type {
  ChannelInboundService,
  ChannelManagementService
} from '../../../ai/agent-platform/channels'
import { assertBoolean } from '../../../ai/agent-platform/channels/ChannelManagementContracts'
import { IpcChannels } from '../../ipc/channels'

/**
 * 渠道管理 / 渠道入站两个服务共 25 个 handler 的注册点。这一步只是搬家：行为逐字未动。
 *
 * **只搬注册**。退出链（`disposePlatformRuntimes()` 的五步顺序、8 个维护定时器、6 个 adapter
 * dispose、`fenceAllForQuit`）仍然留在 `app.ts`：那是一条跨域退出链，搬走任何一段都会在退出
 * 瞬间静默错，而全量验证看不见。
 *
 * 端口只给两个服务——已实测，`getMainWindow` / `settingsStore` / `vault` / Repository /
 * Supervisor / `broadcast*` 在这里都是零命中。
 */
export type ChannelIpcPorts = Readonly<{
  channelManagementService: ChannelManagementService
  channelInboundService: ChannelInboundService
}>

export function registerChannelIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: ChannelIpcPorts
): void {
  const { channelManagementService, channelInboundService } = ports

  ipcMain.handle(IpcChannels.channelsCatalog, () => channelManagementService.catalog())
  ipcMain.handle(IpcChannels.channelsList, () => channelManagementService.list())
  // 只读投影：通知设置页的「发送到通道」一行读它，不缓存第二份通道状态。
  ipcMain.handle(IpcChannels.channelsListDeliveryTargets, () => channelManagementService.listDeliveryTargets())
  ipcMain.handle(IpcChannels.channelsGet, (_event: IpcMainInvokeEvent, id: unknown) => channelManagementService.get(id))
  ipcMain.handle(IpcChannels.channelsCreate, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.create(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsUpdate, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.update(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsDisable, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.disable(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsRequestEnable, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.requestEnable(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsRestart, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.restart(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsDelete, async (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.delete(asChannelInput(input)))
  ipcMain.handle(IpcChannels.channelsCredentialBegin, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.beginCredential({ id: value.id, senderId: _event.sender.id })
  })
  ipcMain.handle(IpcChannels.channelsCredentialSubmit, async (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.provision({ id: value.id, actorId: value.actorId, senderId: _event.sender.id, handoff: asChannelHandoff(value.handoff) })
  })
  ipcMain.handle(IpcChannels.channelsCredentialRotate, async (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.rotate({ id: value.id, actorId: value.actorId, senderId: _event.sender.id, handoff: asChannelHandoff(value.handoff) })
  })
  ipcMain.handle(IpcChannels.channelsPolicyBegin, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.beginPolicy({ id: asChannelInput(input).id, senderId: _event.sender.id }))
  ipcMain.handle(IpcChannels.channelsPolicyCreate, async (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.createPolicy({
      id: value.id,
      actorId: value.actorId,
      senderId: _event.sender.id,
      handoff: asChannelHandoff(value.handoff)
    })
  })
  ipcMain.handle(IpcChannels.channelsListAudits, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listAudits({ id: value.id, limit: value.limit, offset: value.offset })
  })
  ipcMain.handle(IpcChannels.channelsRuntimeStatus, (_event: IpcMainInvokeEvent, input: unknown) => channelManagementService.runtimeStatus({ id: asChannelInput(input).id }))
  ipcMain.handle(IpcChannels.channelsListDeliveryAttempts, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listDeliveryAttempts({ id: value.id, limit: value.limit, offset: value.offset })
  })
  ipcMain.handle(IpcChannels.channelsListDeliveryAudits, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listDeliveryAudits({ id: value.id, limit: value.limit, offset: value.offset })
  })
  // 只读：设置页日志面板的「运行异常」那一类。分页用 keyset 游标，服务端把 limit 夹到 200。
  ipcMain.handle(IpcChannels.channelsListRuntimeAudits, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listRuntimeAudits({ id: value.id, limit: value.limit, cursor: value.cursor })
  })
  ipcMain.handle(IpcChannels.channelsListPolicies, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listPolicies({ id: value.id, limit: value.limit })
  })
  ipcMain.handle(IpcChannels.channelsDeletePolicy, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.deletePolicy({ channelId: value.channelId, policyId: value.policyId, actorId: value.actorId })
  })
  ipcMain.handle(IpcChannels.channelsListConversations, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.listConversations({ id: value.id, limit: value.limit })
  })
  ipcMain.handle(IpcChannels.channelsSetTarget, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelManagementService.setTarget({
      channelId: value.channelId,
      conversationId: value.conversationId,
      enabled: assertBoolean(value.enabled),
      actorId: value.actorId
    })
  })

  ipcMain.handle(IpcChannels.channelsListCandidates, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelInboundService.listCandidates(String(value.id), typeof value.limit === 'number' ? value.limit : 100)
  })
  ipcMain.handle(IpcChannels.channelsAllowCandidate, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelInboundService.allowCandidate({
      channelId: String(value.channelId ?? value.id),
      candidateId: String(value.candidateId),
      enableTarget: assertBoolean(value.enableTarget)
    })
  })
  ipcMain.handle(IpcChannels.channelsIgnoreCandidate, (_event: IpcMainInvokeEvent, input: unknown) => {
    const value = asChannelInput(input)
    return channelInboundService.ignoreCandidate(String(value.channelId ?? value.id), String(value.candidateId))
  })

}

// Channel management re-validates every field at its own contract boundary, so the
// IPC layer only proves that the payload is a plain object before handing it over.
function asChannelInput(input: unknown): any {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error('channel-input-invalid')
  }
  return input
}

function asChannelHandoff(value: unknown): { sessionId: string; rendererPublicJwk: JsonWebKey; iv: Uint8Array; ciphertext: Uint8Array } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('channel-handoff-invalid')
  const handoff = value as Record<string, unknown>
  if (
    typeof handoff.sessionId !== 'string' ||
    !handoff.sessionId.trim() ||
    handoff.sessionId.length > 128 ||
    !isP256PublicJwk(handoff.rendererPublicJwk) ||
    !(handoff.iv instanceof Uint8Array) ||
    !(handoff.ciphertext instanceof Uint8Array)
  ) throw new Error('channel-handoff-invalid')
  return { sessionId: handoff.sessionId, rendererPublicJwk: handoff.rendererPublicJwk as JsonWebKey, iv: handoff.iv, ciphertext: handoff.ciphertext }
}

function isP256PublicJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  const jwk = value as Record<string, unknown>
  return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && jwk.x.length <= 128 && typeof jwk.y === 'string' && jwk.y.length <= 128
}

