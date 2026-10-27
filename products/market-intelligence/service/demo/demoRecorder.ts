/**
 * 录制模式（仅开发用，`MB_SAMPLE_RECORD=1` 开启）。
 *
 * 录的是渲染层真正收到的返回体——因此形状天然等于契约，未来新增接口也不用改导出器。
 * 产物落在 `demo/raw/`，**不入库**：只有人工筛选、脱敏后的 payload 才会进 `demo/scenarios/`。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { requestKeyOf } from './demoPayload'

export type SampleModeRecorder = Readonly<{
  directory: string
  record: (method: string, request: unknown, payload: unknown) => void
  /** 测试用：等待所有在途写入落盘。 */
  settled: () => Promise<void>
}>

export type SampleModeRecorderInput = Readonly<{
  directory: string
  sessionId: string
  now: () => Date
  writeFile?: (path: string, content: string) => Promise<void>
}>

export function createSampleModeRecorder(input: SampleModeRecorderInput): SampleModeRecorder {
  const directory = join(input.directory, input.sessionId)
  const write = input.writeFile ?? ((path: string, content: string) => writeFile(path, content, 'utf8'))
  const inFlight = new Set<Promise<void>>()
  let ready: Promise<void> | undefined

  function ensureDirectory(): Promise<void> {
    ready ??= mkdir(directory, { recursive: true }).then(() => undefined)
    return ready
  }

  function track(work: Promise<void>): void {
    inFlight.add(work)
    void work.finally(() => inFlight.delete(work))
  }

  return Object.freeze({
    directory,
    record(method: string, request: unknown, payload: unknown) {
      // 第二道闸：即使调用方漏了判断，凭据类方法也不会被写进录制目录。
      if (/credential|secret|apikey|api-key/iu.test(method)) return
      const recordedAt = input.now().toISOString()
      const body = {
        method,
        request: scrub(request, request),
        payload: scrub(payload, request),
        recordedAt
      }
      const fileName = `${method}__${requestKeyOf(request)}.json`
      track(
        ensureDirectory()
          .then(() => write(join(directory, fileName), `${JSON.stringify(body, null, 2)}\n`))
          .catch(() => undefined)
      )
    },
    async settled() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    }
  })
}

/**
 * 回显字段换成占位符：与请求 `asOf` 相同的字符串 → `$asOf`。
 *
 * 只换「等于请求值」的那一份，别的字符串一律不动——录制不是脱敏器，脱敏是入库前的人工步骤。
 */
function scrub(value: unknown, request: unknown): unknown {
  const requestedAsOf = request && typeof request === 'object'
    ? (request as Record<string, unknown>).asOf
    : undefined
  if (typeof value === 'string') {
    return typeof requestedAsOf === 'string' && value === requestedAsOf ? '$asOf' : value
  }
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, request))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = scrub(entry, request)
    }
    return result
  }
  return value
}
