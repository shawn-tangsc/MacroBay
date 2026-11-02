import type { BrowserWindow } from 'electron'

import type { AssistantChatRuntimeEventSink } from '../../ai/assistant-platform/runtime/assistantChatRuntimeTypes'
import { IpcChannels } from '../ipc/channels'

/**
 * 把助手运行时的流式回调接到窗口上的装配。
 *
 * 这段曾经在 `app.ts` 里：一个 `broadcastAssistantStreamEvent(channel, payload)` 加四个内联回调，
 * **四个通道名因此长在组合根上**——读 `app.ts` 的人必须知道「哪条事件走哪个通道」。
 * 现在通道名只在这里出现，`app.ts` 只剩一行 `events: createAssistantStreamSink({ getMainWindow })`。
 *
 * **收端口，不直接摸 `BrowserWindow`**：和 `ipc/windowIpc.ts` 同一条边界——窗口从哪来是组合根的事，
 * 这个模块只认「给我一个窗口或 null」，因此不需要 Electron 的运行期对象也能被测。
 *
 * 状态读法：**每次发送前现取窗口**（`getMainWindow()` 而不是缓存引用）——主窗可被销毁重建，
 * 持有旧引用会把事件发进一个已经死掉的窗口，而那种失败在界面上表现为「消息一直转圈」。
 */
export type AssistantStreamPorts = Readonly<{
  getMainWindow: () => BrowserWindow | null
}>

export function createAssistantStreamSink(ports: AssistantStreamPorts): AssistantChatRuntimeEventSink {
  const { getMainWindow } = ports
  // 没有窗口就什么都不发：流式事件是**广播给主窗**的，窗口还没建好时丢弃是正确行为，
  // 攒起来补发只会让晚到的窗口收到一串过期增量。
  const send = (channel: string, payload: unknown): void => {
    getMainWindow()?.webContents.send(channel, payload)
  }

  return {
    onChunk: (payload) => send(IpcChannels.assistantsStreamChunk, payload),
    onDone: (payload) => send(IpcChannels.assistantsStreamDone, payload),
    onError: (payload) => send(IpcChannels.assistantsStreamError, payload),
    onStatus: (snapshot) => send(IpcChannels.assistantsStreamStatusChanged, snapshot)
  }
}
