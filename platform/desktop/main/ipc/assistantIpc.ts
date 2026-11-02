import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { IpcChannels } from '../../ipc/channels'

/**
 * 助手域 29 个 handler 的注册点。只是搬家：行为逐字未动。
 *
 * 端口按**实测闭包**给，只有两个：
 * - `assistantIpcHandlers`：所有 handler 共同调用的那一组实现；
 * - `getLanguage`：四个模板类 handler 在调用方没给语言时回落到当前界面语言。
 *
 * 流事件的广播（`broadcastAssistantStreamEvent` 那四处）不在任何 handler 里，它属于
 * `createAssistantStreamEventBroadcaster` 的构造，仍留在 app.ts —— 新模块不抓 mainWindow 全局。
 */
export type AssistantIpcPorts = Readonly<{
  assistantIpcHandlers: ReturnType<
    typeof import('../assistantIpcHandlers').createAssistantIpcHandlers
  >
  getLanguage: () => Promise<'zh-CN' | 'en-US'>
}>

export function registerAssistantIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  ports: AssistantIpcPorts
): void {
  const { assistantIpcHandlers, getLanguage } = ports

ipcMain.handle(IpcChannels.assistantsList, () => assistantIpcHandlers.listAssistants())
ipcMain.handle(IpcChannels.assistantsGet, (_event: IpcMainInvokeEvent, assistantId: string) =>
  assistantIpcHandlers.getAssistant(assistantId)
)
ipcMain.handle(IpcChannels.assistantsCreate, (_event: IpcMainInvokeEvent, input: unknown) =>
  assistantIpcHandlers.createAssistant(input as Parameters<typeof assistantIpcHandlers.createAssistant>[0])
)
ipcMain.handle(IpcChannels.assistantsUpdate, (_event: IpcMainInvokeEvent, assistantId: string, patch: unknown) =>
  assistantIpcHandlers.updateAssistant(assistantId, patch as Parameters<typeof assistantIpcHandlers.updateAssistant>[1])
)
ipcMain.handle(IpcChannels.assistantsDelete, (_event: IpcMainInvokeEvent, assistantId: string) =>
  assistantIpcHandlers.deleteAssistant(assistantId)
)
ipcMain.handle(IpcChannels.assistantsReorder, (_event: IpcMainInvokeEvent, orderedIds: string[]) =>
  assistantIpcHandlers.reorderAssistants(orderedIds)
)
ipcMain.handle(
  IpcChannels.assistantsLibraryListTemplates,
  async (_event: IpcMainInvokeEvent, query?: unknown, language?: 'zh-CN' | 'en-US') =>
    assistantIpcHandlers.listAssistantTemplates(
      (query as Parameters<typeof assistantIpcHandlers.listAssistantTemplates>[0]) ?? {},
      language ?? await getLanguage()
    )
)
ipcMain.handle(
  IpcChannels.assistantsLibraryGetTemplate,
  async (_event: IpcMainInvokeEvent, templateId: string, language?: 'zh-CN' | 'en-US') =>
    assistantIpcHandlers.getAssistantTemplate(templateId, language ?? await getLanguage())
)
ipcMain.handle(
  IpcChannels.assistantsLibraryInstallTemplate,
  async (_event: IpcMainInvokeEvent, input: unknown, language?: 'zh-CN' | 'en-US') =>
    assistantIpcHandlers.installAssistantTemplate(
      input as Parameters<typeof assistantIpcHandlers.installAssistantTemplate>[0],
      language ?? await getLanguage()
    )
)
ipcMain.handle(
  IpcChannels.assistantsLibraryListGroups,
  async (_event: IpcMainInvokeEvent, language?: 'zh-CN' | 'en-US') =>
    assistantIpcHandlers.listAssistantTemplateGroups(language ?? await getLanguage())
)
ipcMain.handle(IpcChannels.assistantsLibraryCreateAssistant, (_event: IpcMainInvokeEvent, input: unknown) =>
  assistantIpcHandlers.createAssistantFromLibrary(
    input as Parameters<typeof assistantIpcHandlers.createAssistantFromLibrary>[0]
  )
)
ipcMain.handle(IpcChannels.assistantsListTopics, (_event: IpcMainInvokeEvent, query?: unknown) =>
  assistantIpcHandlers.listTopics((query as Parameters<typeof assistantIpcHandlers.listTopics>[0]) ?? {})
)
ipcMain.handle(IpcChannels.assistantsCreateTopic, (_event: IpcMainInvokeEvent, input: unknown) =>
  assistantIpcHandlers.createTopic(input as Parameters<typeof assistantIpcHandlers.createTopic>[0])
)
ipcMain.handle(IpcChannels.assistantsUpdateTopic, (_event: IpcMainInvokeEvent, topicId: string, patch: unknown) =>
  assistantIpcHandlers.updateTopic(topicId, patch as Parameters<typeof assistantIpcHandlers.updateTopic>[1])
)
ipcMain.handle(IpcChannels.assistantsDeleteTopic, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.deleteTopic(topicId)
)
ipcMain.handle(IpcChannels.assistantsPinTopic, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.pinTopic(topicId)
)
ipcMain.handle(IpcChannels.assistantsUnpinTopic, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.unpinTopic(topicId)
)
ipcMain.handle(IpcChannels.assistantsListTopicMessages, (_event: IpcMainInvokeEvent, topicId: string, nodeId?: string | null) =>
  assistantIpcHandlers.listTopicMessages(topicId, nodeId)
)
ipcMain.handle(IpcChannels.assistantsSetActiveNode, (_event: IpcMainInvokeEvent, topicId: string, nodeId: string | null) =>
  assistantIpcHandlers.setActiveNode(topicId, nodeId)
)
ipcMain.handle(
  IpcChannels.assistantsRenameTopic,
  (_event: IpcMainInvokeEvent, topicId: string, name: string, isNameManuallyEdited?: boolean) =>
    assistantIpcHandlers.renameTopic(topicId, name, isNameManuallyEdited)
)
ipcMain.handle(IpcChannels.assistantsCreateMessageSibling, (_event: IpcMainInvokeEvent, messageId: string, dto: unknown) =>
  assistantIpcHandlers.createMessageSibling(messageId, dto as Parameters<typeof assistantIpcHandlers.createMessageSibling>[1])
)
ipcMain.handle(IpcChannels.assistantsEditAndResendUserMessage, (_event: IpcMainInvokeEvent, input: unknown) =>
  assistantIpcHandlers.editAndResendUserMessage(
    input as Parameters<typeof assistantIpcHandlers.editAndResendUserMessage>[0]
  )
)
ipcMain.handle(IpcChannels.assistantsClearTopicMessages, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.clearTopicMessages(topicId)
)
ipcMain.handle(
  IpcChannels.assistantsSearchTopicMessages,
  (_event: IpcMainInvokeEvent, topicId: string, query: string, limit?: number) =>
    assistantIpcHandlers.searchTopicMessages(topicId, query, limit)
)
ipcMain.handle(IpcChannels.assistantsDeleteMessage, (_event: IpcMainInvokeEvent, messageId: string, options?: unknown) =>
  assistantIpcHandlers.deleteMessage(messageId, options as Parameters<typeof assistantIpcHandlers.deleteMessage>[1])
)
ipcMain.handle(IpcChannels.assistantsStreamOpen, (_event: IpcMainInvokeEvent, request: unknown) =>
  assistantIpcHandlers.streamOpen(request as Parameters<typeof assistantIpcHandlers.streamOpen>[0])
)
ipcMain.handle(IpcChannels.assistantsStreamAttach, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.streamAttach(topicId)
)
ipcMain.handle(IpcChannels.assistantsStreamAbort, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.streamAbort(topicId)
)
ipcMain.handle(IpcChannels.assistantsStreamGetStatus, (_event: IpcMainInvokeEvent, topicId: string) =>
  assistantIpcHandlers.streamGetStatus(topicId)
)

}
