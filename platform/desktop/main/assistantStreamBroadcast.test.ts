import { describe, expect, it, vi } from 'vitest'

import { IpcChannels } from '../ipc/channels'

import { createAssistantStreamSink } from './assistantStreamBroadcast'

/** 只实现 `webContents.send`：这个模块对窗口的依赖面就这么大，多一点都是多余的约定。 */
function fakeWindow(): { window: never; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return { window: { webContents: { send } } as never, send }
}

describe('assistant stream sink', () => {
  it('sends every runtime event on its own channel, never on a shared one', () => {
    const { window, send } = fakeWindow()
    const sink = createAssistantStreamSink({ getMainWindow: () => window })

    sink.onChunk?.({ topicId: 't', chunk: 'hi' } as never)
    sink.onDone?.({ topicId: 't' } as never)
    sink.onError?.({ topicId: 't', reason: 'x' } as never)
    sink.onStatus?.({ topicId: 't' } as never)

    // 四条通道名逐条断言：共用一个通道会让渲染层分不清「增量」「结束」「出错」，
    // 而那种错在界面上表现为「消息一直转圈」，不会报任何错。
    expect(send.mock.calls.map(([channel]) => channel)).toEqual([
      IpcChannels.assistantsStreamChunk,
      IpcChannels.assistantsStreamDone,
      IpcChannels.assistantsStreamError,
      IpcChannels.assistantsStreamStatusChanged
    ])
  })

  it('drops the event when no window exists yet, and never queues it', () => {
    const { window, send } = fakeWindow()
    let current: unknown = null
    const sink = createAssistantStreamSink({ getMainWindow: () => current as never })

    // 窗口还没建好：丢弃，不排队。晚到的窗口不该收到一串过期增量。
    expect(() => sink.onChunk?.({ topicId: 't' } as never)).not.toThrow()
    expect(send).not.toHaveBeenCalled()

    // 窗口出现后，下一条事件照常送达——「丢掉」不是「关掉」。
    current = window
    sink.onChunk?.({ topicId: 't' } as never)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
