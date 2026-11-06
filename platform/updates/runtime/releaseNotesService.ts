import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import { releaseNotesLimits } from '../contracts/releaseNotes'
import { isAllowedReleaseNotesApiUrl, updateReleaseNotesApiUrl } from '../updateSource'

/**
 * 内嵌更新说明的取数：**只在需要时取一次，按版本号缓存，失败进内存冷却**。
 *
 * 四条闸门（缺一条就会变成重试风暴或每次进页面都打一次）：
 * 1. 只在「当前结论是有新版本」时被调用（调用方负责，本服务不做结论判断）；
 * 2. 缓存里的版本与目标版本不一致 → 才算没有缓存；
 * 3. 失败后 10 分钟**内存**冷却（不落盘、重启清除）；
 * 4. 没有定时器、没有启动预取——只有页面要的时候才来问。
 *
 * 失败一律表现为「没有这一块」：返回 `null`，不抛、不记 error、不影响版本结论。
 */

export type ReleaseNotesCache = { version: string; fetchedAt: string; text: string }

export type ReleaseNotesServicePorts = Readonly<{
  storage: JsonFileStorage<ReleaseNotesCache>
  fetch: typeof fetch
  now: () => Date
  log: (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void
}>

/** 失败冷却：10 分钟。放进常量是为了测试能引用同一个值。 */
export const releaseNotesFailureCooldownMs = 10 * 60 * 1000
/** 与检查一致：后台动作，多等不打扰人。 */
export const releaseNotesTimeoutMs = 30_000

export type ReleaseNotesService = {
  /**
   * 目标版本的**正文原文**；没有就 `null`（界面表现为整块不出现）。
   *
   * 这一层刻意不认识节点类型：解析规则随组件演进（代码块、行内代码都要多两种节点），
   * 而取数 / 缓存 / 冷却与那些规则无关。解析放在 IPC 那一层，改规则不动这一层。
   */
  getBody: (targetVersion: string) => Promise<string | null>
}

export function createReleaseNotesService(ports: ReleaseNotesServicePorts): ReleaseNotesService {
  /** 失败冷却只放内存：重启即清。 */
  let cooldownUntil: number | null = null

  async function readCache(): Promise<ReleaseNotesCache | null> {
    try {
      const cached = await ports.storage.read()
      return typeof cached?.text === 'string' && typeof cached?.version === 'string' ? cached : null
    } catch (error) {
      // 照 `state.json` 那边的做法记一条：缓存坏了要能查出来，不能全静默。
      ports.log('warn', 'update.notes.cache-read-failed', { message: errorMessage(error) })
      return null
    }
  }

  async function fetchBody(): Promise<string | null> {
    const url = updateReleaseNotesApiUrl()
    if (!isAllowedReleaseNotesApiUrl(url)) {
      ports.log('warn', 'update.notes.rejected-url', { reason: 'not-allowed' })
      return null
    }
    let response: Response
    try {
      response = await ports.fetch(url, {
        signal: AbortSignal.timeout(releaseNotesTimeoutMs),
        headers: { accept: 'application/vnd.github+json' }
      })
    } catch (error) {
      ports.log('warn', 'update.notes.failed', { reason: 'offline', message: errorMessage(error) })
      return null
    }
    if (!response.ok) {
      ports.log('warn', 'update.notes.failed', {
        reason: response.status === 404 ? 'not-found' : response.status === 403 ? 'rate-limited' : 'offline'
      })
      return null
    }

    // ③ 先看声明长度：声明就超限，一个字节都不读。
    const declaredLength = Number(response.headers?.get?.('content-length') ?? Number.NaN)
    if (Number.isFinite(declaredLength) && declaredLength > releaseNotesLimits.bodyBytes) {
      ports.log('warn', 'update.notes.failed', { reason: 'too-large' })
      return null
    }

    let raw: string | null
    try {
      raw = await readBodyWithLimit(response, releaseNotesLimits.bodyBytes)
    } catch (error) {
      ports.log('warn', 'update.notes.failed', {
        reason: error instanceof Error && error.message === tooLargeMessage ? 'too-large' : 'offline',
        message: errorMessage(error)
      })
      return null
    }
    if (raw === null) {
      ports.log('warn', 'update.notes.failed', { reason: 'too-large' })
      return null
    }

    try {
      const parsed = JSON.parse(raw) as { body?: unknown; prerelease?: unknown }
      // `latest` 不会返回 prerelease，但真给了也不显示——与预发布可见规则保持一致。
      if (parsed.prerelease === true) return null
      return typeof parsed.body === 'string' ? parsed.body : null
    } catch {
      ports.log('warn', 'update.notes.failed', { reason: 'invalid-body' })
      return null
    }
  }

  return {
    async getBody(targetVersion: string) {
      const cached = await readCache()
      if (cached !== null && cached.version === targetVersion) {
        return cached.text
      }

      const nowMs = ports.now().getTime()
      if (cooldownUntil !== null && nowMs < cooldownUntil) return null

      const body = await fetchBody()
      if (body === null) {
        cooldownUntil = nowMs + releaseNotesFailureCooldownMs
        return null
      }

      try {
        await ports.storage.write({ version: targetVersion, fetchedAt: ports.now().toISOString(), text: body })
      } catch (error) {
        // 缓存写不进去不影响这一屏：说明照常显示，下次再取。
        ports.log('warn', 'update.notes.cache-write-failed', { message: errorMessage(error) })
      }
      cooldownUntil = null
      return body
    }
  }
}

const tooLargeMessage = 'release-notes-too-large'

/**
 * 流式读取并**到上限即中止**：远端给一个 500 MB 的身体，我们不能先吃下去再拒绝。
 * 拿不到 `body` reader（例如测试替身）时退回归一化的 `text()`，但**仍然按字节数判**。
 */
async function readBodyWithLimit(response: Response, limit: number): Promise<string | null> {
  const body = response.body as (ReadableStream<Uint8Array> | null) | undefined
  if (body === null || body === undefined || typeof body.getReader !== 'function') {
    const text = await response.text()
    return Buffer.byteLength(text, 'utf8') > limit ? null : text
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    received += value.byteLength
    if (received > limit) {
      // 到上限立刻中止：不再往后读，也不把已读的部分交给解析器。
      await reader.cancel().catch(() => undefined)
      throw new Error(tooLargeMessage)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
