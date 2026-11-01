/**
 * SSE 分帧与 JSON 行解析的**唯一**实现。
 *
 * 这里原本有三份逐字相同的副本（助手流式客户端、智能体运行时、responses 读取器）。
 * 三份的下场是「同一个流，三个地方各理解一遍」：改一处、漏两处，出错时还要逐个排除。
 *
 * 只做两件与协议无关的事：把 buffer 切成事件、把一行 `data:` 解析成对象。
 * 至于事件长什么样、怎么累加成回复，归各自的协议客户端。
 */

export type SseEventExtraction = {
  /** 已经完整的 `data:` 载荷，按出现顺序。 */
  items: string[]
  /** 尚未收到分隔符的尾巴，下一次读取时拼回前面。 */
  remainder: string
}

/** 按空行切事件；一个事件里多行 `data:` 用换行拼接（SSE 规范允许）。 */
export function extractSseEvents(buffer: string): SseEventExtraction {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  const items = parts
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n')
    )
    .filter(Boolean)
  return { items, remainder }
}

/**
 * 解析一行 JSON；解析失败返回 null 由调用方决定是跳过还是报错。
 *
 * 不在这里吞错——`catch { return null }` 的语义（少一段回复但不报错）属于调用方，
 * 它必须自己写出来，而不是藏进公共函数里。
 */
export function tryParseJsonChunk(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
