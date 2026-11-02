/**
 * SSE 文本 → 数据帧的唯一读取器。
 *
 * 网关里有两个协议适配器，各自都写过一遍「按行切、认 `data:`、跳过空行、处理 `[DONE]`」。
 * 两份实现的分片边界一样、跳过规则一样，改一处就会漏另一处——所以收成这一个东西，
 * 由适配器各自决定帧到了之后做什么。
 *
 * 语义刻意保持旧写法：只按 `\n` 切，行尾没有换行的残余留到下一片；
 * 流结束时**不**把残余当帧吐出（旧实现同样丢掉）。改这条会改行为，需要单独一次提交。
 */
export type SseDataFrame = { kind: 'data'; payload: string } | { kind: 'done' }

export type SseDataFrameReader = {
  /** 追加一片原始文本，返回这一片里已经完整的帧。 */
  push: (chunk: string) => SseDataFrame[]
}

export function createSseDataFrameReader(): SseDataFrameReader {
  let buffer = ''

  return {
    push(chunk) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      const frames: SseDataFrame[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice('data:'.length).trim()
        if (!payload) continue
        if (payload === '[DONE]') {
          frames.push({ kind: 'done' })
          continue
        }
        frames.push({ kind: 'data', payload })
      }
      return frames
    }
  }
}
